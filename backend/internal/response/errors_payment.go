package response

import "net/http"

// Payment failures (DECISIONS.md D2).
const (
	ErrCodePaymentNotFound       ErrorCode = "TX_PAY_001"
	ErrCodePaymentAlreadyPaid    ErrorCode = "TX_PAY_002"
	ErrCodePaymentCreateFailed   ErrorCode = "TX_PAY_003"
	ErrCodePaymentProviderFailed ErrorCode = "TX_PAY_004"
	ErrCodePaymentUnsupported    ErrorCode = "TX_PAY_005"
	ErrCodePaymentAmountMismatch ErrorCode = "TX_PAY_006"
	ErrCodeWebhookSignature      ErrorCode = "TX_PAY_007"
	ErrCodeWebhookMalformed      ErrorCode = "TX_PAY_008"
	ErrCodePaymentMethodInvalid  ErrorCode = "TX_PAY_009"
	ErrCodePaymentNotPending     ErrorCode = "TX_PAY_010"
	ErrCodePaymentUpdateFailed   ErrorCode = "TX_PAY_011"
)

var (
	ErrPaymentNotFound = &ApplicationError{
		ErrorCode:    ErrCodePaymentNotFound,
		ErrorMessage: "payment not found",
		HttpCode:     http.StatusNotFound,
	}
	// ErrPaymentAlreadyPaid makes double-settlement an explicit, visible refusal rather
	// than a silent second write.
	ErrPaymentAlreadyPaid = &ApplicationError{
		ErrorCode:    ErrCodePaymentAlreadyPaid,
		ErrorMessage: "this order has already been paid",
		HttpCode:     http.StatusConflict,
	}
	ErrPaymentCreateFailed = &ApplicationError{
		ErrorCode:    ErrCodePaymentCreateFailed,
		ErrorMessage: "failed to start the payment",
		HttpCode:     http.StatusInternalServerError,
	}
	// ErrPaymentProviderFailed covers the gateway being down. 502, because the failure is
	// upstream and retrying may well work -- the diner should be told to try again, not
	// that their order is broken.
	ErrPaymentProviderFailed = &ApplicationError{
		ErrorCode:    ErrCodePaymentProviderFailed,
		ErrorMessage: "the payment provider is unavailable, please try again or pay at the counter",
		HttpCode:     http.StatusBadGateway,
	}
	ErrPaymentUnsupported = &ApplicationError{
		ErrorCode:    ErrCodePaymentUnsupported,
		ErrorMessage: "this payment method is not available here",
		HttpCode:     http.StatusConflict,
	}
	// ErrPaymentAmountMismatch fires when a webhook reports an amount that is not the
	// order total. Never auto-settle on a mismatch: an underpayment silently marked paid
	// is money the restaurant loses without ever finding out.
	ErrPaymentAmountMismatch = &ApplicationError{
		ErrorCode:    ErrCodePaymentAmountMismatch,
		ErrorMessage: "the paid amount does not match the order total",
		HttpCode:     http.StatusConflict,
	}
	// ErrWebhookSignature is a rejected HMAC. 401 and nothing else: an unauthenticated
	// caller learns only that it failed.
	ErrWebhookSignature = &ApplicationError{
		ErrorCode:    ErrCodeWebhookSignature,
		ErrorMessage: "signature verification failed",
		HttpCode:     http.StatusUnauthorized,
	}
	ErrWebhookMalformed = &ApplicationError{
		ErrorCode:    ErrCodeWebhookMalformed,
		ErrorMessage: "malformed webhook payload",
		HttpCode:     http.StatusBadRequest,
	}
	ErrPaymentMethodInvalid = &ApplicationError{
		ErrorCode:    ErrCodePaymentMethodInvalid,
		ErrorMessage: "payment method must be online_upi or counter",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrPaymentNotPending = &ApplicationError{
		ErrorCode:    ErrCodePaymentNotPending,
		ErrorMessage: "this payment is no longer awaiting confirmation",
		HttpCode:     http.StatusConflict,
	}
	ErrPaymentUpdateFailed = &ApplicationError{
		ErrorCode:    ErrCodePaymentUpdateFailed,
		ErrorMessage: "failed to update the payment",
		HttpCode:     http.StatusInternalServerError,
	}
)
