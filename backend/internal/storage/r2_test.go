package storage

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

// Presigning is a purely local computation -- it derives a signature, it does not call
// Cloudflare -- so the real client can be exercised here with throwaway credentials. That
// is worth doing: every mistake this catches (a wrong endpoint, a signed header a browser
// cannot send, an addressing style R2 does not serve) otherwise surfaces as
// SignatureDoesNotMatch against a live bucket, which reads as a credentials problem and
// sends whoever is debugging it to rotate a perfectly good token.

func testStore(t *testing.T) Storage {
	t.Helper()
	store, err := NewR2(R2Options{
		AccountID:       "abc123account",
		AccessKeyID:     "AKIAtestkeyid",
		SecretAccessKey: "testsecretaccesskey",
		Bucket:          "tablex-images",
		PublicBaseURL:   "https://img.example.com",
		PresignTTL:      5 * time.Minute,
	})
	if err != nil {
		t.Fatalf("NewR2: %v", err)
	}
	return store
}

func TestNewR2_RequiresEveryOption(t *testing.T) {
	full := R2Options{
		AccountID:       "a",
		AccessKeyID:     "b",
		SecretAccessKey: "c",
		Bucket:          "d",
		PublicBaseURL:   "https://e.example.com",
	}

	for name, blank := range map[string]func(*R2Options){
		"account id": func(o *R2Options) { o.AccountID = "" },
		"access key": func(o *R2Options) { o.AccessKeyID = "" },
		"secret":     func(o *R2Options) { o.SecretAccessKey = "" },
		"bucket":     func(o *R2Options) { o.Bucket = "" },
		"public url": func(o *R2Options) { o.PublicBaseURL = "" },
	} {
		opts := full
		blank(&opts)
		if _, err := NewR2(opts); err == nil {
			t.Errorf("missing %s: NewR2 succeeded", name)
		}
	}
}

func TestPresignPut_TargetsTheR2Endpoint(t *testing.T) {
	upload, err := testStore(t).PresignPut(t.Context(), "menu/rst_a/itm_b/img_c.jpg", "image/jpeg", 1234)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}

	parsed, err := url.Parse(upload.URL)
	if err != nil {
		t.Fatalf("the presigned URL does not parse: %v", err)
	}

	// The account endpoint, not an AWS one. Getting this wrong is the single most confusing
	// failure available here, because the credentials are valid and the request goes nowhere
	// near the bucket.
	if parsed.Host != "abc123account.r2.cloudflarestorage.com" {
		t.Errorf("host = %q, want the account's R2 endpoint", parsed.Host)
	}
	if parsed.Scheme != "https" {
		t.Errorf("scheme = %q, want https", parsed.Scheme)
	}

	// Path-style addressing: /{bucket}/{key}. Virtual-host style would put the bucket in the
	// hostname and need per-bucket DNS to exist.
	if parsed.Path != "/tablex-images/menu/rst_a/itm_b/img_c.jpg" {
		t.Errorf("path = %q, want /{bucket}/{key}", parsed.Path)
	}

	if upload.Method != "PUT" {
		t.Errorf("method = %q, want PUT", upload.Method)
	}
}

func TestPresignPut_SignsWithTheAutoRegionAndAnExpiry(t *testing.T) {
	upload, err := testStore(t).PresignPut(t.Context(), "menu/rst_a/itm_b/img_c.jpg", "image/png", 99)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}

	query := mustQuery(t, upload.URL)

	// R2 requires the credential scope's region to be exactly "auto". Anything else fails
	// signature verification with an error that names the signature, not the region.
	credential := query.Get("X-Amz-Credential")
	if !strings.Contains(credential, "/auto/s3/aws4_request") {
		t.Errorf("X-Amz-Credential = %q, want the auto region in the scope", credential)
	}
	if query.Get("X-Amz-Expires") == "" {
		t.Error("the URL carries no expiry")
	}
	if query.Get("X-Amz-Signature") == "" {
		t.Error("the URL carries no signature")
	}

	if upload.ExpiresAt.Before(time.Now().UTC()) {
		t.Error("ExpiresAt is already in the past")
	}
}

// THE ONE THAT PROTECTS THE BROWSER UPLOAD.
//
// Recent versions of the S3 client default to adding and signing an x-amz-checksum-crc32
// header on PutObject. A browser doing a plain PUT of a File sends no such header, so the
// signature never matches and every upload fails with a 403 that looks like a credentials
// problem. r2.go sets RequestChecksumCalculation to WhenRequired to prevent that; this
// pins it, because the default has changed before and would change silently again.
func TestPresignPut_DoesNotDemandAChecksumTheBrowserCannotSend(t *testing.T) {
	upload, err := testStore(t).PresignPut(t.Context(), "menu/rst_a/itm_b/img_c.jpg", "image/jpeg", 4096)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}

	signed := mustQuery(t, upload.URL).Get("X-Amz-SignedHeaders")
	for _, forbidden := range []string{"x-amz-checksum", "x-amz-sdk-checksum", "content-md5"} {
		if strings.Contains(signed, forbidden) {
			t.Errorf("SignedHeaders contains %q -- a browser PUT cannot supply it, so every upload would 403.\n  got: %s",
				forbidden, signed)
		}
	}

	for name := range upload.Headers {
		lower := strings.ToLower(name)
		if strings.Contains(lower, "checksum") {
			t.Errorf("the client is asked to send %q, which it has no way to compute", name)
		}
	}
}

// Content-Length IS part of the signature (verified: SignedHeaders comes back as
// "content-length;content-type;host"). That is what makes the size ceiling enforced by R2 at
// upload time rather than only by our confirm step -- a body of a different length than was
// presigned produces a signature mismatch and never lands in the bucket at all.
//
// The browser computes and sends it automatically from the blob, which is why it is signed
// but NOT handed back in Headers. Pinned here because losing it would quietly downgrade the
// size limit to a post-hoc check.
func TestPresignPut_SignsTheContentLength(t *testing.T) {
	upload, err := testStore(t).PresignPut(t.Context(), "menu/rst_a/itm_b/img_c.jpg", "image/jpeg", 4096)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}

	signed := mustQuery(t, upload.URL).Get("X-Amz-SignedHeaders")
	if !strings.Contains(signed, "content-length") {
		t.Errorf("content-length is not signed, so R2 would accept a body of any size; SignedHeaders = %q", signed)
	}
}

// Host and Content-Length are forbidden header names in fetch and XHR: script cannot set
// either, and the browser supplies both. Returning them would have a frontend try, and the
// resulting console warning sends whoever debugs it looking in the wrong place.
func TestPresignPut_ReturnsOnlyHeadersAScriptCanSet(t *testing.T) {
	upload, err := testStore(t).PresignPut(t.Context(), "menu/rst_a/itm_b/img_c.jpg", "image/webp", 4096)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}

	for name := range upload.Headers {
		switch strings.ToLower(name) {
		case "host", "content-length":
			t.Errorf("Headers includes %q, which a browser refuses to let script set", name)
		}
	}
}

// The content type has to be inside the signature, or a client could declare image/jpeg,
// receive a URL, and store an HTML document under it with a content type of its choosing.
func TestPresignPut_SignsTheContentType(t *testing.T) {
	upload, err := testStore(t).PresignPut(t.Context(), "menu/rst_a/itm_b/img_c.jpg", "image/jpeg", 4096)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}

	signed := mustQuery(t, upload.URL).Get("X-Amz-SignedHeaders")
	if !strings.Contains(signed, "content-type") {
		t.Fatalf("content-type is not signed; SignedHeaders = %q", signed)
	}

	// And it must be handed back, since the browser has to replay exactly what was signed.
	found := ""
	for name, value := range upload.Headers {
		if strings.EqualFold(name, "Content-Type") {
			found = value
		}
	}
	if found != "image/jpeg" {
		t.Errorf("Content-Type header returned to the client = %q, want image/jpeg", found)
	}
}

// A different key must produce a different URL. Presigning is per-object, and a signature
// that covered the bucket rather than the key would be a capability to overwrite anything.
func TestPresignPut_IsScopedToOneKey(t *testing.T) {
	store := testStore(t)

	first, err := store.PresignPut(t.Context(), "menu/rst_a/itm_b/img_one.jpg", "image/jpeg", 10)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}
	second, err := store.PresignPut(t.Context(), "menu/rst_a/itm_b/img_two.jpg", "image/jpeg", 10)
	if err != nil {
		t.Fatalf("PresignPut: %v", err)
	}

	if mustQuery(t, first.URL).Get("X-Amz-Signature") == mustQuery(t, second.URL).Get("X-Amz-Signature") {
		t.Fatal("two different keys produced the same signature")
	}
}

func TestPublicURL(t *testing.T) {
	store := testStore(t)

	got := store.PublicURL("menu/rst_a/itm_b/img_c.jpg")
	want := "https://img.example.com/menu/rst_a/itm_b/img_c.jpg"
	if got != want {
		t.Errorf("PublicURL = %q, want %q", got, want)
	}

	// The separators must survive: escaping the key would turn "/" into "%2F" and every
	// image would 404.
	if strings.Contains(got, "%2F") {
		t.Error("PublicURL escaped the path separators")
	}

	if store.PublicURL("") != "" {
		t.Error("an empty key produced a URL")
	}
}

func TestPublicURL_ToleratesATrailingSlashInConfiguration(t *testing.T) {
	store, err := NewR2(R2Options{
		AccountID:       "a",
		AccessKeyID:     "b",
		SecretAccessKey: "c",
		Bucket:          "d",
		// Somebody will paste this with a trailing slash. A doubled separator would 404 on
		// some CDNs and silently work on others, which is the worst combination.
		PublicBaseURL: "https://img.example.com/",
	})
	if err != nil {
		t.Fatalf("NewR2: %v", err)
	}

	if got := store.PublicURL("menu/x.jpg"); got != "https://img.example.com/menu/x.jpg" {
		t.Errorf("PublicURL = %q, want no doubled slash", got)
	}
}

func mustQuery(t *testing.T, raw string) url.Values {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return parsed.Query()
}
