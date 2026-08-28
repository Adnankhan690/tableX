package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// r2Region is the region every R2 bucket reports.
//
// R2 is not regional in the way S3 is -- Cloudflare places the data and there is no region
// to choose -- but SigV4 requires a region string in the credential scope, and R2 requires
// that string to be exactly "auto". Anything else fails signature verification with an
// error that names the signature rather than the region, which is a bad afternoon.
const r2Region = "auto"

// r2 is the Cloudflare R2 implementation of Storage.
//
// The S3 client here is a protocol client, not an AWS one; see the package doc. Nothing in
// this file talks to Amazon.
type r2 struct {
	client    *s3.Client
	presign   *s3.PresignClient
	bucket    string
	publicVia string
	ttl       time.Duration
}

// R2Options is everything needed to reach one bucket.
type R2Options struct {
	// AccountID is the Cloudflare account the bucket belongs to. It forms the endpoint
	// hostname, which is why it is needed separately from the credentials.
	AccountID string
	// AccessKeyID and SecretAccessKey are an R2 API token from the Cloudflare dashboard,
	// scoped to Object Read & Write on this one bucket. They are not AWS keys and will not
	// work against AWS.
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	// PublicBaseURL is the origin a diner's browser fetches images from: a custom domain
	// bound to the bucket, e.g. https://img.tabley.in.
	//
	// NOT the r2.cloudflarestorage.com endpoint, which is the authenticated API and serves
	// nothing publicly, and preferably not the bucket's r2.dev subdomain either -- that one
	// is rate limited and Cloudflare documents it as unsuitable for production.
	PublicBaseURL string
	// PresignTTL bounds how long an upload URL stays usable.
	PresignTTL time.Duration
}

// NewR2 builds the R2-backed store.
//
// Credentials are supplied statically and never discovered. The SDK's default chain would
// otherwise fall back to ambient AWS environment variables, an EC2 instance role or
// ~/.aws/credentials -- so a developer with unrelated AWS keys exported would find this
// silently authenticating somewhere else entirely, and the failure would be a 403 from a
// service nobody meant to call.
func NewR2(opts R2Options) (Storage, error) {
	if opts.AccountID == "" || opts.AccessKeyID == "" || opts.SecretAccessKey == "" ||
		opts.Bucket == "" || opts.PublicBaseURL == "" {
		return nil, fmt.Errorf("storage: r2 requires account id, credentials, bucket and public base url")
	}

	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", opts.AccountID)

	cfg := aws.Config{
		Region:      r2Region,
		Credentials: credentials.NewStaticCredentialsProvider(opts.AccessKeyID, opts.SecretAccessKey, ""),
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		// Path style (endpoint/bucket/key) rather than virtual host style
		// (bucket.endpoint/key). Both work against R2, but path style is what Cloudflare
		// documents and it needs no per-bucket DNS to exist.
		o.UsePathStyle = true

		// CHECKSUMS OFF UNLESS REQUIRED, AND THIS LINE IS LOAD-BEARING FOR UPLOADS.
		//
		// Recent versions of the S3 client default to WhenSupported, which adds an
		// x-amz-checksum-crc32 header to PutObject and signs it. A presigned URL carrying
		// that in its signature can only be used by a client that sends the same header with
		// a correct checksum -- and a browser doing a plain PUT of a File sends no such
		// header. The upload then fails with SignatureDoesNotMatch, which reads as a
		// credentials problem and is not one.
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	})

	ttl := opts.PresignTTL
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}

	return &r2{
		client:    client,
		presign:   s3.NewPresignClient(client),
		bucket:    opts.Bucket,
		publicVia: strings.TrimRight(opts.PublicBaseURL, "/"),
		ttl:       ttl,
	}, nil
}

func (r *r2) Configured() bool { return true }

// PresignPut mints a one-object write capability.
//
// ContentType and ContentLength are both set on the input so both end up INSIDE the
// signature -- verified: SignedHeaders comes back as "content-length;content-type;host".
//
// That is stronger than it looks. Because the length is signed, R2 itself refuses a body of
// any other size, so the upload ceiling is enforced at the bucket rather than only after the
// fact. The browser supplies the header automatically from the blob it sends, so a client
// cannot simply omit it.
//
// It is still not the whole guarantee. A signature proves the client sent what it promised;
// it says nothing about whether what it promised was a photograph. Hence the confirm path,
// which measures the stored object and sniffs its leading bytes.
func (r *r2) PresignPut(
	ctx context.Context,
	key, contentType string,
	sizeBytes int64,
) (*PresignedUpload, error) {
	req, err := r.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(r.bucket),
		Key:           aws.String(key),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(sizeBytes),
	}, s3.WithPresignExpires(r.ttl))
	if err != nil {
		return nil, fmt.Errorf("storage: presign put %q: %w", key, err)
	}

	return &PresignedUpload{
		URL:       req.URL,
		Method:    req.Method,
		Headers:   browserSettableHeaders(req.SignedHeader),
		ExpiresAt: time.Now().UTC().Add(r.ttl),
	}, nil
}

// browserSettableHeaders drops the signed headers a browser refuses to let script set.
//
// Both removed names are still part of the signature and still have to arrive correctly --
// the browser just supplies them itself:
//
//   - Host is a forbidden header name; fetch and XMLHttpRequest silently ignore an attempt
//     to set it, and it is derived from the URL anyway.
//   - Content-Length is likewise forbidden, and the browser computes it from the body. That
//     is exactly the behaviour wanted: a body of a different length than was presigned
//     produces a mismatch against the signed value and R2 rejects the upload.
//
// Returning them would invite a frontend to try, and the resulting console warning sends
// whoever debugs it looking in the wrong place.
func browserSettableHeaders(signed http.Header) map[string]string {
	out := make(map[string]string, len(signed))
	for name, values := range signed {
		switch strings.ToLower(name) {
		case "host", "content-length":
			continue
		}
		if len(values) > 0 {
			out[name] = values[0]
		}
	}
	return out
}

func (r *r2) Head(ctx context.Context, key string) (*ObjectInfo, error) {
	out, err := r.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if isNotFound(err) {
			return nil, ErrObjectNotFound
		}
		return nil, fmt.Errorf("storage: head %q: %w", key, err)
	}

	info := &ObjectInfo{Key: key}
	if out.ContentLength != nil {
		info.SizeBytes = *out.ContentLength
	}
	if out.ContentType != nil {
		info.ContentType = *out.ContentType
	}
	if out.ETag != nil {
		info.ETag = *out.ETag
	}
	return info, nil
}

func (r *r2) Peek(ctx context.Context, key string, n int64) ([]byte, error) {
	if n <= 0 {
		return nil, nil
	}

	out, err := r.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
		// Inclusive on both ends, per RFC 7233, hence n-1.
		Range: aws.String(fmt.Sprintf("bytes=0-%d", n-1)),
	})
	if err != nil {
		if isNotFound(err) {
			return nil, ErrObjectNotFound
		}
		return nil, fmt.Errorf("storage: peek %q: %w", key, err)
	}
	defer func() { _ = out.Body.Close() }()

	// LimitReader as well as the Range header: the range is a request, and a store that
	// ignored it would otherwise stream a whole file into memory on a path whose entire
	// purpose is to avoid doing that.
	head, err := io.ReadAll(io.LimitReader(out.Body, n))
	if err != nil {
		return nil, fmt.Errorf("storage: read %q: %w", key, err)
	}
	return head, nil
}

// Delete removes an object, treating an already-absent key as success.
//
// S3-compatible deletes are idempotent by design and R2 answers 204 for a key that was
// never there. Surfacing that as an error would make the caller's cleanup path -- which
// runs after a commit and cannot undo it -- log a failure for the one outcome it wanted.
func (r *r2) Delete(ctx context.Context, key string) error {
	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil && !isNotFound(err) {
		return fmt.Errorf("storage: delete %q: %w", key, err)
	}
	return nil
}

func (r *r2) PublicURL(key string) string {
	if key == "" {
		return ""
	}
	// No escaping: MenuItemKey emits only lowercase base32, "_", "/" and one ".", all of
	// which are safe in a path. Escaping here would corrupt the "/" separators.
	return r.publicVia + "/" + key
}

// isNotFound reports whether an S3 error means "that key does not exist".
//
// Both shapes are checked because the two operations report absence differently: HeadObject
// has no body to carry an error code and yields NotFound, while GetObject yields NoSuchKey.
// Matching only one leaves the other surfacing as an opaque 404 that the caller then treats
// as an outage.
func isNotFound(err error) bool {
	var notFound *s3types.NotFound
	if errors.As(err, &notFound) {
		return true
	}
	var noSuchKey *s3types.NoSuchKey
	return errors.As(err, &noSuchKey)
}
