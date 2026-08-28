// Package storage is the object-store seam for dish photographs (DECISIONS.md D15).
//
// One interface, two implementations, mirroring the payment seam (DECISIONS.md D2): a
// deployment either has an object store configured or it does not, and the rest of the
// application branches on Configured() rather than on which store it is. That is what
// keeps "this deployment does not host images" a single boolean instead of a nil check
// scattered through the menu service.
//
// # This is Cloudflare R2, not AWS
//
// r2.go imports github.com/aws/aws-sdk-go-v2/service/s3 and that is not a mistake, an
// accident, or a leftover. R2 publishes no Go SDK of its own; its documented integration
// is the S3 HTTP API, so the S3 client is the protocol client, pointed at
// https://{account_id}.r2.cloudflarestorage.com with credentials issued by the Cloudflare
// dashboard. No AWS account, bucket, region or bill exists anywhere in this path -- the
// relationship is the same as using a Postgres driver to talk to CockroachDB.
//
// The reason R2 was chosen over S3, GCS or Firebase Storage is egress: R2 charges none,
// ever, and a menu is a read-heavy workload whose bandwidth bill would otherwise scale
// with exactly the traffic the product is trying to attract.
package storage

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors. Callers in package services map these onto ApplicationErrors, because
// only a service knows whether a missing object is a 404 or an expected absence -- the
// same rule that governs gorm.ErrRecordNotFound throughout this codebase.
var (
	// ErrNotConfigured means this deployment has no object store, so uploads are not a
	// thing it can do. Distinct from a failure: nothing is broken.
	ErrNotConfigured = errors.New("storage: no object store is configured for this deployment")
	// ErrObjectNotFound means the key does not exist in the bucket.
	ErrObjectNotFound = errors.New("storage: object not found")
)

// ObjectInfo is what a HEAD reveals about a stored object.
//
// ContentType is what the UPLOADER declared, not what the bytes are. It is attacker-
// controlled in the same way a form field is, which is why the confirm path sniffs the
// leading bytes rather than trusting this. See DetectContentType.
type ObjectInfo struct {
	Key         string
	SizeBytes   int64
	ContentType string
	ETag        string
}

// PresignedUpload is a time-boxed capability to write exactly one object.
//
// Headers must be replayed by the browser VERBATIM. They are part of the signature, so
// adding, dropping or re-casing one produces a 403 from R2 rather than a partial upload --
// which is the intended behaviour, since those headers are what pin the upload to one
// content type and one size.
type PresignedUpload struct {
	URL       string
	Method    string
	Headers   map[string]string
	ExpiresAt time.Time
}

// Storage is the object store this deployment writes dish photographs to.
//
// Deliberately five methods and no more. Every one of them is on the upload-a-dish-photo
// path; there is no List, because listing is the expensive operation on an object store
// (a Class A request on R2, ~12x the price of a read) and nothing here needs it -- the
// object key lives on the menu_item row, so the database is the index.
type Storage interface {
	// Configured reports whether this deployment can store objects at all.
	Configured() bool

	// PresignPut returns a URL the browser can PUT one object to directly.
	//
	// Direct-to-bucket rather than proxied through this API on purpose: the API runs on a
	// 512MB free-tier instance, and streaming a manager's 6MB phone photo through it would
	// occupy a request worker and the instance's bandwidth for no benefit. The bytes never
	// touch us.
	PresignPut(ctx context.Context, key, contentType string, sizeBytes int64) (*PresignedUpload, error)

	// Head reports on an object without transferring it.
	Head(ctx context.Context, key string) (*ObjectInfo, error)

	// Peek reads the first n bytes, for content sniffing at confirm time.
	//
	// A ranged read rather than a full one: 512 bytes is all http.DetectContentType needs,
	// and fetching a whole image to check its first eight bytes would put the upload's
	// bandwidth back onto the API instance that PresignPut just kept it off.
	Peek(ctx context.Context, key string, n int64) ([]byte, error)

	// Delete removes an object. Deleting a key that is already gone is not an error --
	// the caller wants it absent, and it is.
	Delete(ctx context.Context, key string) error

	// PublicURL resolves a key to the URL a diner's browser will fetch.
	//
	// Built at read time from configuration, never stored on the row, so that changing the
	// CDN hostname in front of the bucket is a config change rather than an UPDATE over
	// every menu_item in the database.
	PublicURL(key string) string
}
