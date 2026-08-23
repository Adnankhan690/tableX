// Package response defines the wire contract: one success envelope, one error type, and
// one helper that every controller uses to reply.
//
// The layering rule this package exists to enforce: repositories return wrapped plain
// errors, services return *ApplicationError, and controllers do nothing but map. A
// service never writes an HTTP status code and a controller never decides what went
// wrong.
package response

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Canonical success values, sent on every 2xx.
const (
	CodeSuccess = "00000"
	MsgSuccess  = "success"
)

// Envelope is the shape of every response, success or failure.
//
// A single shape means the frontend has one parser and one error path rather than
// branching on status codes to decide how to read the body.
type Envelope struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
	// RequestID is echoed so a diner can read it off a failure screen and a developer can
	// grep one request out of a night's logs.
	RequestID string `json:"request_id,omitempty"`
}

// ErrorCode is a stable, machine-readable identifier for a failure.
//
// Stable is the point: the frontend switches on these, and translating an error message
// into Hindi (PRD 7) must not change program behaviour. Messages are for humans, codes
// are for code.
type ErrorCode string

// ApplicationError is the only error type that crosses the service boundary. It carries
// the HTTP status alongside the code so the controller has nothing left to decide.
type ApplicationError struct {
	ErrorCode    ErrorCode `json:"code"`
	ErrorMessage string    `json:"message"`
	HttpCode     int       `json:"-"`
	// Details carries field-level validation feedback. Never populated with internal
	// error text -- a database error's message can name columns and constraints, which is
	// not something to hand an anonymous diner.
	Details map[string]string `json:"details,omitempty"`
}

// Error implements the error interface.
func (e *ApplicationError) Error() string {
	if e == nil {
		return ""
	}
	return string(e.ErrorCode) + ": " + e.ErrorMessage
}

// WithDetails returns a copy carrying field-level validation details.
//
// A copy, not a mutation: the package-level error values are shared singletons, and
// mutating one would leak one request's validation details into every later response that
// used the same error.
func (e *ApplicationError) WithDetails(details map[string]string) *ApplicationError {
	if e == nil {
		return nil
	}
	clone := *e
	clone.Details = details
	return &clone
}

// WithMessage returns a copy carrying a more specific human-readable message, keeping the
// code and status intact.
func (e *ApplicationError) WithMessage(msg string) *ApplicationError {
	if e == nil {
		return nil
	}
	clone := *e
	clone.ErrorMessage = msg
	return &clone
}

// requestIDKey is the gin context key the request-id middleware writes.
const requestIDKey = "request_id"

// Send is the single reply helper used by every controller. A non-nil appErr wins; a nil
// appErr with nil data still sends a well-formed success envelope.
func Send(ctx *gin.Context, data any, appErr *ApplicationError) {
	reqID, _ := ctx.Get(requestIDKey)
	reqIDStr, _ := reqID.(string)

	if appErr != nil {
		ctx.AbortWithStatusJSON(appErr.HttpCode, Envelope{
			Code:      string(appErr.ErrorCode),
			Message:   appErr.ErrorMessage,
			Data:      detailsData(appErr),
			RequestID: reqIDStr,
		})
		return
	}

	ctx.JSON(http.StatusOK, Envelope{
		Code:      CodeSuccess,
		Message:   MsgSuccess,
		Data:      data,
		RequestID: reqIDStr,
	})
}

// SendCreated replies 201 for a resource that was just created.
func SendCreated(ctx *gin.Context, data any) {
	reqID, _ := ctx.Get(requestIDKey)
	reqIDStr, _ := reqID.(string)

	ctx.JSON(http.StatusCreated, Envelope{
		Code:      CodeSuccess,
		Message:   MsgSuccess,
		Data:      data,
		RequestID: reqIDStr,
	})
}

// detailsData surfaces validation details inside Data, so the envelope keeps exactly one
// payload field regardless of whether the response succeeded.
func detailsData(e *ApplicationError) any {
	if len(e.Details) == 0 {
		return nil
	}
	return map[string]any{"details": e.Details}
}
