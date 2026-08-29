package types

import "time"

// RequestBookDemo is the landing page's demo form (apps/diner marketing sections/book-demo.tsx).
//
// Four fields, three of them required, and the shape is copied from the form rather than the form
// from the shape -- every field here is a reason for a prospect to close the tab, so anything the
// first phone call can establish instead does not belong.
type RequestBookDemo struct {
	Name           string `json:"name" binding:"required,min=1,max=128"`
	RestaurantName string `json:"restaurant_name" binding:"required,min=1,max=160"`
	// Phone is accepted in whatever shape the owner types it -- "+91 98765 43210" and
	// "9876543210" are the same number -- and normalised by the service before it is compared
	// or stored. The bound length is generous for that reason: it bounds the raw string, and the
	// ten-digit rule is applied after the spaces, dashes and country code come off.
	// No min length here on purpose. A too-short number is a wrong number, not an unbindable
	// body, and it must reach the service so the owner gets "that does not look like a 10-digit
	// mobile number" (TX_DEM_002) instead of the generic "the request could not be understood".
	// The max only bounds what is worth parsing.
	Phone string `json:"phone" binding:"required,max=24"`
	// Email is optional. The callback is a phone call, so requiring an address would cost leads
	// to buy a field nobody uses. When it is supplied it becomes the notification's Reply-To.
	Email string `json:"email,omitempty" binding:"omitempty,email,max=255"`
}

// ResponseBookDemo confirms the booking.
//
// It echoes nothing the caller did not send except the uid and the time, and that is deliberate:
// this endpoint is public and unauthenticated, so a response that could be used to read back
// somebody else's lead would be the only way to read one at all.
type ResponseBookDemo struct {
	UID string `json:"uid"`
	// Name is echoed so the page can greet the person by name without trusting the form state it
	// still holds -- which, after a successful submit, it is about to clear.
	Name        string    `json:"name"`
	RequestedAt time.Time `json:"requested_at"`
}
