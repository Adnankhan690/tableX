package config

import (
	"strings"
	"testing"
	"time"
)

// The storage block's validation rules (DECISIONS.md D15).
//
// Each one exists because the mistake it catches produces a deployment that looks healthy
// and serves no photographs -- a class of failure that is invisible until a diner loads a
// menu, which is the worst time to find it.

// validStorage is a fully configured block, so each test can break exactly one thing and
// attribute the failure to it.
func validStorage() StorageConfig {
	return StorageConfig{
		R2: R2Config{
			AccountID:       "abc123",
			AccessKeyID:     "key",
			SecretAccessKey: "secret",
			Bucket:          "tablex-images",
			PublicBaseURL:   "https://img.example.com",
		},
		MaxUploadBytes: 5 << 20,
		PresignTTL:     5 * time.Minute,
	}
}

func TestStorageValidate_AcceptsAFullyConfiguredBlock(t *testing.T) {
	cfg := validStorage()
	if problems := cfg.validate(true); len(problems) > 0 {
		t.Fatalf("a valid block was rejected: %v", problems)
	}
	if !cfg.UploadsEnabled() {
		t.Fatal("UploadsEnabled() is false for a fully configured block")
	}
}

// The common and correct case: a deployment that hosts no images at all. It must boot in
// silence, or every developer without a bucket is blocked.
func TestStorageValidate_AcceptsAnEmptyBlock(t *testing.T) {
	cfg := StorageConfig{MaxUploadBytes: 5 << 20, PresignTTL: 5 * time.Minute}

	if problems := cfg.validate(true); len(problems) > 0 {
		t.Fatalf("an empty block should be valid, got: %v", problems)
	}
	if cfg.UploadsEnabled() {
		t.Fatal("UploadsEnabled() is true with no credentials")
	}
}

// A half-filled block is a typo, not a choice. Treating it as "disabled" would let a deploy
// that was meant to enable uploads report success and do nothing.
func TestStorageValidate_RejectsAHalfFilledBlock(t *testing.T) {
	for _, blank := range []struct {
		name  string
		apply func(*R2Config)
	}{
		{"account id", func(r *R2Config) { r.AccountID = "" }},
		{"access key", func(r *R2Config) { r.AccessKeyID = "" }},
		{"secret", func(r *R2Config) { r.SecretAccessKey = "" }},
		{"bucket", func(r *R2Config) { r.Bucket = "" }},
		{"public base url", func(r *R2Config) { r.PublicBaseURL = "" }},
	} {
		cfg := validStorage()
		blank.apply(&cfg.R2)

		problems := cfg.validate(false)
		if len(problems) == 0 {
			t.Errorf("missing %s: expected a startup error, got none", blank.name)
			continue
		}
		// The message has to name what is missing. "storage.r2 is invalid" would send
		// somebody reading a deploy log to compare five values by eye.
		if !strings.Contains(problems[0], "partially configured") {
			t.Errorf("missing %s: message does not explain the problem: %q", blank.name, problems[0])
		}
		if cfg.UploadsEnabled() {
			t.Errorf("missing %s: UploadsEnabled() is true", blank.name)
		}
	}
}

// The mistake that is easiest to make and hardest to diagnose: pointing the public origin at
// the authenticated API endpoint. Every dish photo then 401s, and the bucket, the
// credentials and the keys are all perfectly correct.
func TestStorageValidate_RejectsTheAPIEndpointAsAPublicOrigin(t *testing.T) {
	cfg := validStorage()
	cfg.R2.PublicBaseURL = "https://abc123.r2.cloudflarestorage.com"

	problems := cfg.validate(false)
	if len(problems) == 0 {
		t.Fatal("the r2.cloudflarestorage.com endpoint was accepted as a public origin")
	}
	if !strings.Contains(problems[0], "custom domain") {
		t.Errorf("message does not say what to do instead: %q", problems[0])
	}
}

// The bucket's "S3 API" row in the Cloudflare dashboard shows a whole URL, so pasting that
// into account_id (or its tail into bucket) is the natural mistake from that screen. Both
// produce a mangled endpoint and a DNS failure that reads as an outage.
func TestStorageValidate_RejectsAPastedS3EndpointURL(t *testing.T) {
	for name, apply := range map[string]func(*StorageConfig){
		"whole endpoint as account id": func(c *StorageConfig) {
			c.R2.AccountID = "https://abc123.r2.cloudflarestorage.com/tablex-images"
		},
		"bare host as account id": func(c *StorageConfig) {
			c.R2.AccountID = "abc123.r2.cloudflarestorage.com"
		},
		"bucket carrying a path": func(c *StorageConfig) {
			c.R2.Bucket = "/tablex-images"
		},
	} {
		cfg := validStorage()
		apply(&cfg)
		if problems := cfg.validate(false); len(problems) == 0 {
			t.Errorf("%s: accepted", name)
		}
	}

	// A plain id and a plain bucket name stay valid -- the guard must not reject the real thing.
	cfg := validStorage()
	cfg.R2.AccountID = "4a1b9c8d7e6f5432a1b9c8d7e6f54321"
	cfg.R2.Bucket = "tablex-images"
	if problems := cfg.validate(false); len(problems) > 0 {
		t.Errorf("a legitimate account id and bucket were rejected: %v", problems)
	}
}

func TestStorageValidate_RequiresAScheme(t *testing.T) {
	cfg := validStorage()
	cfg.R2.PublicBaseURL = "img.example.com"

	if problems := cfg.validate(false); len(problems) == 0 {
		t.Fatal("a schemeless public base url was accepted")
	}
}

// http images on an https page are blocked as mixed content and render as nothing, so the
// menu looks broken rather than insecure. Allowed locally, refused in production.
func TestStorageValidate_RequiresHTTPSInProductionOnly(t *testing.T) {
	cfg := validStorage()
	cfg.R2.PublicBaseURL = "http://localhost:9000"

	if problems := cfg.validate(false); len(problems) > 0 {
		t.Errorf("http should be allowed outside production, got: %v", problems)
	}
	if problems := cfg.validate(true); len(problems) == 0 {
		t.Error("http was accepted in production")
	}
}

func TestStorageValidate_BoundsTheUploadSize(t *testing.T) {
	cfg := validStorage()

	cfg.MaxUploadBytes = 0
	if problems := cfg.validate(false); len(problems) == 0 {
		t.Error("a zero upload limit was accepted")
	}

	cfg.MaxUploadBytes = -1
	if problems := cfg.validate(false); len(problems) == 0 {
		t.Error("a negative upload limit was accepted")
	}

	// An unbounded ceiling defeats the point of having one: the cost lands on every 3G diner
	// who loads the menu, not on the manager who uploaded it.
	cfg.MaxUploadBytes = maxAllowedUploadBytes + 1
	if problems := cfg.validate(false); len(problems) == 0 {
		t.Error("an upload limit past the ceiling was accepted")
	}

	cfg.MaxUploadBytes = maxAllowedUploadBytes
	if problems := cfg.validate(false); len(problems) > 0 {
		t.Errorf("the ceiling itself was refused: %v", problems)
	}
}

// The presign URL is a write capability against the bucket. The browser uses it in seconds;
// anything long-lived is a credential left lying around.
func TestStorageValidate_BoundsThePresignTTL(t *testing.T) {
	cfg := validStorage()

	cfg.PresignTTL = 0
	if problems := cfg.validate(false); len(problems) == 0 {
		t.Error("a zero presign ttl was accepted")
	}

	cfg.PresignTTL = 2 * time.Hour
	if problems := cfg.validate(false); len(problems) == 0 {
		t.Error("a two-hour presign ttl was accepted")
	}

	cfg.PresignTTL = time.Hour
	if problems := cfg.validate(false); len(problems) > 0 {
		t.Errorf("an hour should be allowed: %v", problems)
	}
}

// Defaults must be usable as they stand: a deployment that sets only credentials, which is
// what render.yaml does, gets these.
func TestDefaults_StorageIsValidWithoutFurtherConfiguration(t *testing.T) {
	cfg := Defaults()

	if problems := cfg.Storage.validate(true); len(problems) > 0 {
		t.Fatalf("the default storage block is invalid: %v", problems)
	}
	if cfg.Storage.MaxUploadBytes <= 0 || cfg.Storage.PresignTTL <= 0 {
		t.Fatalf("defaults are unset: max=%d ttl=%s", cfg.Storage.MaxUploadBytes, cfg.Storage.PresignTTL)
	}
	if cfg.Storage.UploadsEnabled() {
		t.Fatal("uploads are enabled by default -- credentials must be required")
	}
}
