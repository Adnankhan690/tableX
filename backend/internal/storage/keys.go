package storage

import (
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"tablex/internal/utils"
)

// The image content types this platform accepts, and the file extension each is stored
// under.
//
// WHAT IS ABSENT MATTERS MORE THAN WHAT IS PRESENT.
//
//   - image/svg+xml is excluded and must stay excluded. An SVG is a script-bearing
//     document: a browser rendering one from our image host executes whatever <script> it
//     contains, on that host's origin. Every other entry here is an inert raster format
//     that no browser will execute whatever the bytes turn out to be.
//   - image/gif is excluded because nothing on a menu needs animation, and each accepted
//     format is another decoder a hostile file gets to reach.
//
// The map is also the extension table, so the two cannot drift: adding a format here is
// the whole change.
var extensionByContentType = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
}

// SniffBytes is how many leading bytes the confirm path reads to identify a file.
//
// 512 because that is what http.DetectContentType consumes; a shorter read makes it
// guess, and guessing is the failure mode this check exists to remove.
const SniffBytes = 512

// AllowedContentTypes lists the accepted types, sorted, for error messages and for the
// admin app's file picker to filter on. Built rather than duplicated so a format added
// above appears in the message and the picker without a second edit.
func AllowedContentTypes() []string {
	out := make([]string, 0, len(extensionByContentType))
	for contentType := range extensionByContentType {
		out = append(out, contentType)
	}
	// Sorted so the error message a manager reads is stable between deployments, and so
	// tests do not depend on map iteration order.
	sort.Strings(out)
	return out
}

// ExtensionFor returns the stored file extension for a content type, and whether the type
// is accepted at all.
func ExtensionFor(contentType string) (string, bool) {
	ext, ok := extensionByContentType[normalizeContentType(contentType)]
	return ext, ok
}

// normalizeContentType strips parameters and case, so "IMAGE/JPEG; charset=binary" -- which
// is a thing real browsers send -- matches "image/jpeg".
func normalizeContentType(contentType string) string {
	if i := strings.IndexByte(contentType, ';'); i >= 0 {
		contentType = contentType[:i]
	}
	return strings.ToLower(strings.TrimSpace(contentType))
}

// DetectContentType identifies a file from its leading bytes, returning "" when the
// content is not one of the accepted image formats.
//
// This is the check that makes the declared Content-Type irrelevant. A presigned PUT lets
// the browser choose the bytes it sends, so a caller can declare image/jpeg and upload an
// HTML document; the stored object would then be served with an image content type it does
// not match. Sniffing at confirm time is what stops that object from ever being attached
// to a dish.
func DetectContentType(head []byte) string {
	detected := normalizeContentType(http.DetectContentType(head))
	if _, ok := extensionByContentType[detected]; !ok {
		return ""
	}
	return detected
}

// SameContentType reports whether two content types name the same format, ignoring case
// and parameters.
//
// Used at confirm time to check that the type R2 will SERVE the object as matches the type
// its bytes actually are. Comparing the raw strings would fail on "image/jpeg" against
// "image/jpeg; charset=binary", which is a thing browsers send.
func SameContentType(a, b string) bool {
	return normalizeContentType(a) == normalizeContentType(b)
}

// --- Key layout ---
//
// A dish photograph's object key is:
//
//	menu/{restaurant_uid}/{item_uid}/{image_uid}.{ext}
//
// Every segment earns its place:
//
//   - restaurant_uid makes tenancy structural rather than remembered. A key names the
//     tenant that owns it, so a cross-tenant mapping is visible by inspection, a bucket
//     lifecycle rule can be scoped to one restaurant, and the confirm path can refuse a
//     key belonging to somebody else without a database lookup (DECISIONS.md D3).
//   - item_uid is the mapping the whole feature turns on: given an object you can name the
//     dish, and given a dish you can find its objects. It is also what lets confirm prove
//     the key it is being handed was minted for THIS menu item.
//   - image_uid is fresh on every upload, so replacing a photograph writes a NEW key rather
//     than overwriting one. Overwriting would leave every CDN edge and every phone that
//     already fetched the old bytes serving them from cache against the same URL, which
//     reads as "the upload silently did nothing". A new key is cache-busting for free.
//
// The extension is carried because R2 serves the object directly to browsers and some
// intermediaries still take a content hint from the path.

// keyPrefix is the top-level folder every dish photograph lives under, leaving room for
// other object kinds (a restaurant logo, an export) without them colliding or sharing a
// lifecycle rule.
const keyPrefix = "menu"

// uidSuffix matches the part of a uid after its prefix.
//
// A LENGTH RANGE, NOT A FIXED 12. utils.GenerateUID emits exactly twelve characters, and
// pinning that here looked precise and was wrong: seeded and hand-written uids are readable
// words of whatever length they need -- rst_demospicegarden, cat_demomains -- and this
// pattern rejected every one of them, so the demo restaurant could not attach a photo to any
// dish while a freshly onboarded one could. The bound is 60 because uid is VARCHAR(64) and
// the prefix plus separator take four.
//
// What the character class is actually for is unchanged: it excludes "/" and ".", which is
// what makes path traversal and extension smuggling unrepresentable rather than merely
// filtered. Underscores and hyphens are allowed because a readable uid may contain them and
// they are harmless -- each segment is captured whole and compared verbatim, never re-split.
const uidSuffix = `[0-9a-z_-]{1,60}`

// menuItemKeyPattern is the ONLY thing that decides whether a client-supplied key is
// acceptable, so it is anchored and exact rather than a prefix test.
//
// Built from the uid constants rather than spelled out, so renaming a prefix cannot leave
// this silently rejecting every real key.
var menuItemKeyPattern = regexp.MustCompile(fmt.Sprintf(
	`^%s/(%s_%s)/(%s_%s)/%s_%s\.(?:jpg|png|webp)$`,
	keyPrefix,
	utils.UIDPrefixRestaurant, uidSuffix,
	utils.UIDPrefixMenuItem, uidSuffix,
	utils.UIDPrefixImage, uidSuffix,
))

// MenuItemKey mints a fresh object key for one dish's photograph.
//
// Returns an error rather than a zero value for an unaccepted content type: this is called
// after validation, so reaching it with a bad type means a caller skipped a check, and
// producing a key with no extension would push that mistake into the bucket.
func MenuItemKey(restaurantUID, itemUID, contentType string) (string, error) {
	ext, ok := ExtensionFor(contentType)
	if !ok {
		return "", fmt.Errorf("storage: %q is not an accepted image type", contentType)
	}
	return fmt.Sprintf("%s/%s/%s/%s.%s",
		keyPrefix, restaurantUID, itemUID, utils.GenerateUID(utils.UIDPrefixImage), ext), nil
}

// ParseMenuItemKey extracts the restaurant and menu item a key belongs to.
//
// The second return is false for anything that is not exactly a dish-photograph key, which
// includes every hostile shape: an absolute path, a traversal, another tenant's prefix with
// a suffix appended, a key with a second extension.
//
// CALLERS MUST COMPARE BOTH RETURNED UIDS against the authenticated actor's restaurant and
// the item being edited. Parsing proves the key is well-formed; it does not prove it is
// yours, and skipping the comparison would let one restaurant point a dish at another
// restaurant's object -- a data-isolation bug, not a style note.
func ParseMenuItemKey(key string) (restaurantUID, itemUID string, ok bool) {
	match := menuItemKeyPattern.FindStringSubmatch(key)
	if match == nil {
		return "", "", false
	}
	return match[1], match[2], true
}

// IsMenuItemKey reports whether a key is a well-formed dish-photograph key.
//
// Used to tell an object this platform minted from a URL a restaurant pasted, so that
// clearing a dish's photograph deletes bytes we own and never issues a delete against
// something we merely linked to.
func IsMenuItemKey(key string) bool {
	_, _, ok := ParseMenuItemKey(key)
	return ok
}
