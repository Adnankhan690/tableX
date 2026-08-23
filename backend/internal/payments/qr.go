package payments

import (
	"encoding/base64"
	"fmt"

	qrcode "github.com/skip2/go-qrcode"
)

// RenderQRPNG encodes content as a PNG QR code and returns it base64 encoded, ready to
// drop into a data URI.
//
// Rendered server-side rather than in the browser so the diner's phone downloads no QR
// library on a 3G connection (PRD 7), and so the printable table-QR sheet in the admin
// panel is one request instead of one per table.
//
// Medium error correction: enough redundancy to survive a phone camera at an angle in
// restaurant lighting, without inflating the module count so far that the code stops
// scanning at sticker size.
func RenderQRPNG(content string, size int) (string, error) {
	if content == "" {
		return "", fmt.Errorf("payments: cannot render an empty QR code")
	}
	if size <= 0 {
		size = 512
	}
	// Bounded: an unbounded size is a trivial way to make the server allocate a very large
	// image on request.
	if size > 2048 {
		size = 2048
	}

	png, err := qrcode.Encode(content, qrcode.Medium, size)
	if err != nil {
		return "", fmt.Errorf("payments: render QR: %w", err)
	}
	return base64.StdEncoding.EncodeToString(png), nil
}
