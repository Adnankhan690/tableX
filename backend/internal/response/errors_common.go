package response

import (
	"context"
	"errors"
	"net/http"
)

// Cross-cutting failures, not owned by any one domain.
//
// Code scheme: TX_<AREA>_<NNN>. Areas are COM (common), AUT (auth), RST (restaurant),
// TBL (table), MNU (menu), ORD (order), PAY (payment), SES (session).
const (
	ErrCodeInvalidRequest ErrorCode = "TX_COM_001"
	ErrCodeInvalidParams  ErrorCode = "TX_COM_002"
	ErrCodeInternal       ErrorCode = "TX_COM_003"
	ErrCodeNotFound       ErrorCode = "TX_COM_004"
	ErrCodeForbidden      ErrorCode = "TX_COM_005"
	ErrCodeRateLimited    ErrorCode = "TX_COM_006"
	ErrCodeConflict       ErrorCode = "TX_COM_007"
	ErrCodeValidation     ErrorCode = "TX_COM_008"
	ErrCodeClientClosed   ErrorCode = "TX_COM_009"
)

var (
	// ErrInvalidRequest covers a malformed or unbindable body.
	ErrInvalidRequest = &ApplicationError{
		ErrorCode:    ErrCodeInvalidRequest,
		ErrorMessage: "the request could not be understood",
		HttpCode:     http.StatusBadRequest,
	}
	// ErrInvalidParams covers a bad path or query parameter.
	ErrInvalidParams = &ApplicationError{
		ErrorCode:    ErrCodeInvalidParams,
		ErrorMessage: "invalid request parameters",
		HttpCode:     http.StatusBadRequest,
	}
	// ErrInternal is the deliberately vague catch-all.
	//
	// It says nothing about what failed, because the audience is an anonymous diner and
	// the detail belongs in the log line the service already wrote. The request id in the
	// envelope is how the two are joined back up.
	ErrInternal = &ApplicationError{
		ErrorCode:    ErrCodeInternal,
		ErrorMessage: "something went wrong on our side",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrNotFound = &ApplicationError{
		ErrorCode:    ErrCodeNotFound,
		ErrorMessage: "not found",
		HttpCode:     http.StatusNotFound,
	}
	ErrForbidden = &ApplicationError{
		ErrorCode:    ErrCodeForbidden,
		ErrorMessage: "you do not have access to this resource",
		HttpCode:     http.StatusForbidden,
	}
	ErrRateLimited = &ApplicationError{
		ErrorCode:    ErrCodeRateLimited,
		ErrorMessage: "too many requests, please slow down",
		HttpCode:     http.StatusTooManyRequests,
	}
	ErrConflict = &ApplicationError{
		ErrorCode:    ErrCodeConflict,
		ErrorMessage: "the resource changed while you were working on it",
		HttpCode:     http.StatusConflict,
	}
	ErrValidation = &ApplicationError{
		ErrorCode:    ErrCodeValidation,
		ErrorMessage: "some fields are invalid",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	// ErrClientClosed means the caller disconnected before we answered.
	//
	// 499 is nginx's non-standard "client closed request", used here for the same reason nginx
	// invented it: this is not a server fault and must not be counted as one. Treating it as a
	// 500 fills the error log with false alarms and makes any 5xx alert fire whenever someone
	// navigates away mid-load -- which, on a phone, is constantly.
	//
	// Nobody reads the response, so the status exists purely for logs and metrics.
	ErrClientClosed = &ApplicationError{
		ErrorCode:    ErrCodeClientClosed,
		ErrorMessage: "the client disconnected before the request completed",
		HttpCode:     StatusClientClosedRequest,
	}
)

// StatusClientClosedRequest is nginx's 499. Not in net/http, because it is not in the RFC.
const StatusClientClosedRequest = 499

// IsClientGone reports whether err is the caller having disconnected or timed out, rather than
// anything being wrong on our side.
//
// Both cases arrive as a cancelled context: a browser aborting a fetch (React re-running an effect,
// a navigation, a closed tab) surfaces as context.Canceled, and our own request deadline surfaces
// as context.DeadlineExceeded. Neither is worth an ERROR line or a 5xx.
func IsClientGone(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}
