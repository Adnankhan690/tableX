// Package utils holds the small cross-layer helpers: identifier generation, money
// formatting, and request parsing.
package utils

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
)

// UID prefixes. Every externally visible identifier is prefixed, so a value that leaks
// into a log or a support ticket is self-describing and an id pasted into the wrong
// endpoint fails loudly instead of resolving to an unrelated row.
const (
	UIDPrefixRestaurant = "rst"
	UIDPrefixStaff      = "stf"
	UIDPrefixTable      = "tbl"
	UIDPrefixCategory   = "cat"
	UIDPrefixMenuItem   = "itm"
	UIDPrefixGuest      = "gst"
	UIDPrefixOrder      = "ord"
	UIDPrefixOrderItem  = "oit"
	UIDPrefixPayment    = "pay"
	// UIDPrefixDemo names a demo request from the landing page. Prefixed like everything else
	// even though nothing addresses one over HTTP yet -- the uid is what an operator quotes when
	// they call the lead back, and "which row is dmo_x7k2m9qp4rt8" is a question a support
	// conversation asks.
	UIDPrefixDemo = "dmo"
	// UIDPrefixImage names one uploaded object. Fresh on every upload rather than reused
	// per dish, so replacing a photograph writes a new object key and no CDN edge can keep
	// serving the previous bytes from cache (DECISIONS.md D15).
	UIDPrefixImage = "img"
)

// uidAlphabet is Crockford-style base32 without padding: unambiguous when read aloud or
// re-typed off a printed QR card.
var uidAlphabet = base32.NewEncoding("0123456789ABCDEFGHJKMNPQRSTVWXYZ").WithPadding(base32.NoPadding)

// randomString returns n characters of cryptographically random base32.
//
// It panics on a crypto/rand failure rather than returning an error. That failure means
// the OS entropy source is broken, at which point every token this process issues -- QR
// tokens, guest session tokens -- is unsafe, so continuing is worse than crashing.
func randomString(n int) string {
	buf := make([]byte, (n*5+7)/8+1)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("utils: crypto/rand unavailable: %v", err))
	}
	return strings.ToLower(uidAlphabet.EncodeToString(buf))[:n]
}

// GenerateUID returns a prefixed identifier, e.g. "ord_x7k2m9qp4rt8".
func GenerateUID(prefix string) string {
	return fmt.Sprintf("%s_%s", prefix, randomString(12))
}

// GenerateQRToken returns the opaque token embedded in a table's QR URL.
//
// 32 characters of base32 is ~160 bits. This is not a database key but a capability: it
// is the only thing stopping someone from ordering onto another table, so it is sized to
// be unguessable rather than merely unique (DECISIONS.md D4).
func GenerateQRToken() string { return randomString(32) }

// GenerateSessionToken returns the diner's guest bearer token (DECISIONS.md D5).
func GenerateSessionToken() string { return randomString(48) }

// GeneratePaymentReference returns the short reference echoed in the UPI transaction note.
//
// Uppercase and only 10 characters because a staff member reads it off a bank SMS and
// matches it to an order by eye (DECISIONS.md D2).
func GeneratePaymentReference() string {
	return "TX" + strings.ToUpper(randomString(8))
}

// Slugify converts a restaurant name into the URL segment used by the restaurant-level
// fallback QR, /r/{slug}.
func Slugify(s string) string {
	var b strings.Builder
	lastDash := true // leading dashes are suppressed
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}
