package storage

import (
	"bytes"
	"strings"
	"testing"

	"tablex/internal/utils"
)

// The key layout is the whole of the menu-item-to-object mapping, and it is pure -- no
// bucket, no database, no fixture. So it is tested exhaustively here rather than through
// the service, the same way the order state machine is (DECISIONS.md D1).

func TestMenuItemKeyRoundTrips(t *testing.T) {
	restaurantUID := utils.GenerateUID(utils.UIDPrefixRestaurant)
	itemUID := utils.GenerateUID(utils.UIDPrefixMenuItem)

	for _, contentType := range AllowedContentTypes() {
		key, err := MenuItemKey(restaurantUID, itemUID, contentType)
		if err != nil {
			t.Fatalf("MenuItemKey(%q) returned an error: %v", contentType, err)
		}

		gotRestaurant, gotItem, ok := ParseMenuItemKey(key)
		if !ok {
			t.Fatalf("ParseMenuItemKey(%q) rejected a key this package just minted", key)
		}
		if gotRestaurant != restaurantUID {
			t.Errorf("restaurant uid: got %q, want %q", gotRestaurant, restaurantUID)
		}
		if gotItem != itemUID {
			t.Errorf("item uid: got %q, want %q", gotItem, itemUID)
		}
	}
}

// Two uploads for the same dish must never collide on one key. Overwriting would leave
// every CDN edge serving the previous bytes against an unchanged URL.
func TestMenuItemKeyIsUniquePerUpload(t *testing.T) {
	restaurantUID := utils.GenerateUID(utils.UIDPrefixRestaurant)
	itemUID := utils.GenerateUID(utils.UIDPrefixMenuItem)

	seen := make(map[string]bool, 256)
	for i := 0; i < 256; i++ {
		key, err := MenuItemKey(restaurantUID, itemUID, "image/jpeg")
		if err != nil {
			t.Fatalf("MenuItemKey: %v", err)
		}
		if seen[key] {
			t.Fatalf("MenuItemKey produced a duplicate key on iteration %d: %q", i, key)
		}
		seen[key] = true
	}
}

// REGRESSION: the pattern once required exactly twelve characters after each prefix, which
// is what utils.GenerateUID emits -- so every generated uid passed and every SEEDED one
// failed. The demo restaurant could not attach a photo to any dish, while a freshly
// onboarded restaurant could, which is the most confusing shape a bug can have.
//
// These are the real uid shapes out of backend/seeds/local_seed.sql.
func TestMenuItemKeyAcceptsSeededUIDsOfAnyLength(t *testing.T) {
	cases := []struct{ restaurant, item string }{
		{"rst_demospicegarden", "itm_demopaneertikka"},    // 15 / 15
		{"rst_democoastalcurry", "itm_demofishamritsari"}, // 16 / 17
		{"rst_demospicegarden", "itm_5apxch82bsnv"},       // seeded restaurant, generated dish
		{"rst_9ff2r1pb0srq", "itm_5apxch82bsnv"},          // both generated, 12 / 12
		{"rst_a", "itm_b"},                                // minimum plausible
		{"rst_spice_garden", "itm_paneer-tikka"},          // separators inside a readable uid
	}

	for _, c := range cases {
		key, err := MenuItemKey(c.restaurant, c.item, "image/png")
		if err != nil {
			t.Errorf("MenuItemKey(%q, %q): %v", c.restaurant, c.item, err)
			continue
		}
		gotRestaurant, gotItem, ok := ParseMenuItemKey(key)
		if !ok {
			t.Errorf("ParseMenuItemKey rejected a key this package just minted: %q", key)
			continue
		}
		if gotRestaurant != c.restaurant || gotItem != c.item {
			t.Errorf("round trip for %q: got (%q, %q)", key, gotRestaurant, gotItem)
		}
	}
}

// The bound exists because uid is VARCHAR(64); a segment longer than the column could never
// name a real row, so accepting it would only widen what a caller can send.
func TestParseMenuItemKeyRejectsOverlongSegments(t *testing.T) {
	long := "rst_" + strings.Repeat("a", 61)
	key := "menu/" + long + "/itm_b/img_c.jpg"
	if IsMenuItemKey(key) {
		t.Errorf("accepted a uid segment longer than the column: %q", key)
	}
}

func TestMenuItemKeyRejectsUnacceptedContentTypes(t *testing.T) {
	restaurantUID := utils.GenerateUID(utils.UIDPrefixRestaurant)
	itemUID := utils.GenerateUID(utils.UIDPrefixMenuItem)

	// image/svg+xml is the one that matters: an SVG executes script in the browser that
	// renders it, so accepting it would turn the image host into a place to serve one.
	for _, contentType := range []string{"image/svg+xml", "image/gif", "text/html", "application/pdf", ""} {
		if _, err := MenuItemKey(restaurantUID, itemUID, contentType); err == nil {
			t.Errorf("MenuItemKey accepted %q, which is not an allowed image type", contentType)
		}
	}
}

// ParseMenuItemKey is the only gate between a client-supplied string and a bucket
// operation, so every hostile shape is asserted rather than assumed.
func TestParseMenuItemKeyRejectsHostileKeys(t *testing.T) {
	restaurant := utils.GenerateUID(utils.UIDPrefixRestaurant)
	item := utils.GenerateUID(utils.UIDPrefixMenuItem)
	image := utils.GenerateUID(utils.UIDPrefixImage)
	valid := "menu/" + restaurant + "/" + item + "/" + image + ".jpg"

	if !IsMenuItemKey(valid) {
		t.Fatalf("the control key %q should be valid", valid)
	}

	cases := map[string]string{
		"parent traversal":        "menu/" + restaurant + "/../" + item + "/" + image + ".jpg",
		"traversal in image name": "menu/" + restaurant + "/" + item + "/../../etc/passwd",
		"absolute path":           "/menu/" + restaurant + "/" + item + "/" + image + ".jpg",
		"leading whitespace":      " menu/" + restaurant + "/" + item + "/" + image + ".jpg",
		"trailing newline":        valid + "\n",
		"double extension":        "menu/" + restaurant + "/" + item + "/" + image + ".jpg.html",
		"disallowed extension":    "menu/" + restaurant + "/" + item + "/" + image + ".svg",
		"no extension":            "menu/" + restaurant + "/" + item + "/" + image,
		"wrong top-level prefix":  "logos/" + restaurant + "/" + item + "/" + image + ".jpg",
		"prefix not anchored":     "x/menu/" + restaurant + "/" + item + "/" + image + ".jpg",
		"suffix after extension":  valid + "?x=1",
		"extra path segment":      "menu/" + restaurant + "/" + item + "/nested/" + image + ".jpg",
		"missing segment":         "menu/" + restaurant + "/" + image + ".jpg",
		"restaurant uid as item":  "menu/" + restaurant + "/" + restaurant + "/" + image + ".jpg",
		"uppercase uid":           "menu/" + strings.ToUpper(restaurant) + "/" + item + "/" + image + ".jpg",
		"empty":                   "",
	}

	for name, key := range cases {
		if IsMenuItemKey(key) {
			t.Errorf("%s: ParseMenuItemKey accepted %q", name, key)
		}
	}
}

// A well-formed key belonging to somebody else parses successfully -- that is the point of
// returning the uids rather than a bare bool. The refusal is the caller's job, and this
// records that the data it needs to refuse is actually available.
func TestParseMenuItemKeySurfacesForeignOwnership(t *testing.T) {
	theirs := utils.GenerateUID(utils.UIDPrefixRestaurant)
	item := utils.GenerateUID(utils.UIDPrefixMenuItem)
	image := utils.GenerateUID(utils.UIDPrefixImage)
	mine := utils.GenerateUID(utils.UIDPrefixRestaurant)

	key := "menu/" + theirs + "/" + item + "/" + image + ".jpg"

	owner, _, ok := ParseMenuItemKey(key)
	if !ok {
		t.Fatalf("a well-formed key should parse even when it belongs to another tenant")
	}
	if owner == mine {
		t.Fatal("test setup is broken: the two restaurant uids collided")
	}
	if owner != theirs {
		t.Errorf("owner: got %q, want %q", owner, theirs)
	}
}

func TestDetectContentTypeAcceptsRealImageHeaders(t *testing.T) {
	// Minimal but genuine magic numbers for each accepted format.
	cases := map[string][]byte{
		"image/jpeg": {0xFF, 0xD8, 0xFF, 0xE0},
		"image/png":  {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A},
		"image/webp": append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), make([]byte, 8)...),
	}

	for want, head := range cases {
		if got := DetectContentType(head); got != want {
			t.Errorf("DetectContentType for %s: got %q, want %q", want, got, want)
		}
	}
}

// The check that makes a presigned upload safe: the bytes decide, not the declared type.
func TestDetectContentTypeRejectsDisguisedContent(t *testing.T) {
	cases := map[string][]byte{
		"html document": []byte("<!DOCTYPE html><html><script>alert(1)</script></html>"),
		"svg":           []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script/></svg>`),
		"gif":           []byte("GIF89a\x01\x00\x01\x00"),
		"pdf":           []byte("%PDF-1.7\n"),
		"zip":           {0x50, 0x4B, 0x03, 0x04},
		"elf binary":    {0x7F, 'E', 'L', 'F'},
		"empty":         {},
		"plain text":    []byte("this is just a caption, not a photograph"),
	}

	for name, head := range cases {
		if got := DetectContentType(head); got != "" {
			t.Errorf("%s: DetectContentType returned %q, want \"\" (rejected)", name, got)
		}
	}
}

// A JPEG whose header sits inside the first 512 bytes is still detected; the sniff window
// is a constant this test pins so shrinking it fails loudly.
func TestDetectContentTypeUsesLeadingBytesOnly(t *testing.T) {
	jpeg := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte{0x00}, SniffBytes*4)...)
	if got := DetectContentType(jpeg[:SniffBytes]); got != "image/jpeg" {
		t.Errorf("got %q, want image/jpeg", got)
	}
}

func TestExtensionForNormalizesContentType(t *testing.T) {
	// Browsers really do send parameters and mixed case on a File's type.
	for _, contentType := range []string{"image/jpeg", "IMAGE/JPEG", " image/jpeg ", "image/jpeg; charset=binary"} {
		ext, ok := ExtensionFor(contentType)
		if !ok || ext != "jpg" {
			t.Errorf("ExtensionFor(%q) = (%q, %v), want (\"jpg\", true)", contentType, ext, ok)
		}
	}
}

func TestUnconfiguredStoreRefusesWorkButNeverPanics(t *testing.T) {
	store := NewUnconfigured()

	if store.Configured() {
		t.Error("the unconfigured store must report Configured() == false")
	}
	if _, err := store.PresignPut(t.Context(), "k", "image/jpeg", 1); err != ErrNotConfigured {
		t.Errorf("PresignPut: got %v, want ErrNotConfigured", err)
	}
	if _, err := store.Head(t.Context(), "k"); err != ErrNotConfigured {
		t.Errorf("Head: got %v, want ErrNotConfigured", err)
	}
	if _, err := store.Peek(t.Context(), "k", 512); err != ErrNotConfigured {
		t.Errorf("Peek: got %v, want ErrNotConfigured", err)
	}
	// Delete succeeds and PublicURL is blank: both are called on paths that must degrade
	// rather than fail when the configuration goes away.
	if err := store.Delete(t.Context(), "k"); err != nil {
		t.Errorf("Delete: got %v, want nil", err)
	}
	if url := store.PublicURL("menu/a/b/c.jpg"); url != "" {
		t.Errorf("PublicURL: got %q, want an empty string rather than a URL that cannot resolve", url)
	}
}
