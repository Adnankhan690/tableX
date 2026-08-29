package response

import "net/http"

// Demo request failures. Area DEM, for the landing page's one write.
const (
	ErrCodeDemoAlreadyBooked ErrorCode = "TX_DEM_001"
	ErrCodeDemoInvalidPhone  ErrorCode = "TX_DEM_002"
	ErrCodeDemoSaveFailed    ErrorCode = "TX_DEM_003"
)

var (
	// ErrDemoAlreadyBooked means this number has asked already.
	//
	// 409 rather than 422, and the message is deliberately warm rather than corrective. The
	// caller is a restaurant owner who filled in a form twice, most often because the first
	// submission's confirmation was missed -- what they need to hear is "we have it", not that
	// they did something wrong. The landing page renders this as a success-shaped panel for
	// exactly that reason.
	ErrDemoAlreadyBooked = &ApplicationError{
		ErrorCode:    ErrCodeDemoAlreadyBooked,
		ErrorMessage: "we already have a demo request against this number and will be in touch",
		HttpCode:     http.StatusConflict,
	}
	// ErrDemoInvalidPhone covers a number that is not a ten-digit Indian mobile.
	//
	// Checked server-side even though the form checks it too: the route is public and
	// unauthenticated, so the browser's validation is a convenience for honest callers and
	// nothing more. It is also what keeps the uniqueness rule meaningful -- a number that is not
	// normalisable cannot be compared against the ones already stored.
	ErrDemoInvalidPhone = &ApplicationError{
		ErrorCode:    ErrCodeDemoInvalidPhone,
		ErrorMessage: "that does not look like a 10-digit mobile number",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrDemoSaveFailed = &ApplicationError{
		ErrorCode:    ErrCodeDemoSaveFailed,
		ErrorMessage: "we could not record your request, please try again",
		HttpCode:     http.StatusInternalServerError,
	}
)
