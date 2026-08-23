package response

import "net/http"

// Order lifecycle failures.
const (
	ErrCodeOrderNotFound          ErrorCode = "TX_ORD_001"
	ErrCodeOrderEmptyCart         ErrorCode = "TX_ORD_002"
	ErrCodeOrderCreateFailed      ErrorCode = "TX_ORD_003"
	ErrCodeOrderFetchFailed       ErrorCode = "TX_ORD_004"
	ErrCodeOrderInvalidStatus     ErrorCode = "TX_ORD_005"
	ErrCodeOrderTransitionIllegal ErrorCode = "TX_ORD_006"
	ErrCodeOrderAlreadyAccepted   ErrorCode = "TX_ORD_007"
	ErrCodeOrderTerminal          ErrorCode = "TX_ORD_008"
	ErrCodeOrderNotYours          ErrorCode = "TX_ORD_009"
	ErrCodeOrderCancelTooLate     ErrorCode = "TX_ORD_010"
	ErrCodeOrderEditNotAllowed    ErrorCode = "TX_ORD_011"
	ErrCodeOrderUpdateFailed      ErrorCode = "TX_ORD_012"
	ErrCodeOrderQuantityInvalid   ErrorCode = "TX_ORD_013"
	ErrCodeOrderTooManyItems      ErrorCode = "TX_ORD_014"
	ErrCodeOrderReasonRequired    ErrorCode = "TX_ORD_015"
	ErrCodeOrderNumberFailed      ErrorCode = "TX_ORD_016"
)

var (
	ErrOrderNotFound = &ApplicationError{
		ErrorCode:    ErrCodeOrderNotFound,
		ErrorMessage: "order not found",
		HttpCode:     http.StatusNotFound,
	}
	ErrOrderEmptyCart = &ApplicationError{
		ErrorCode:    ErrCodeOrderEmptyCart,
		ErrorMessage: "your cart is empty",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrOrderCreateFailed = &ApplicationError{
		ErrorCode:    ErrCodeOrderCreateFailed,
		ErrorMessage: "we could not place your order, please try again",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrOrderFetchFailed = &ApplicationError{
		ErrorCode:    ErrCodeOrderFetchFailed,
		ErrorMessage: "failed to load orders",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrOrderInvalidStatus = &ApplicationError{
		ErrorCode:    ErrCodeOrderInvalidStatus,
		ErrorMessage: "that is not a valid order status",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	// ErrOrderTransitionIllegal is the state machine's refusal (DECISIONS.md D1). 409, not
	// 400: the request was well-formed and would have been legal a moment ago -- the
	// order simply moved on. The admin panel reacts by refetching, not by showing a
	// validation error.
	ErrOrderTransitionIllegal = &ApplicationError{
		ErrorCode:    ErrCodeOrderTransitionIllegal,
		ErrorMessage: "this order has already moved on, refresh to see its current state",
		HttpCode:     http.StatusConflict,
	}
	// ErrOrderAlreadyAccepted is the specific, common case of the above: two staff phones
	// tapped Accept at the same moment. Distinct code so the UI can say something exact.
	ErrOrderAlreadyAccepted = &ApplicationError{
		ErrorCode:    ErrCodeOrderAlreadyAccepted,
		ErrorMessage: "this order was already accepted by someone else",
		HttpCode:     http.StatusConflict,
	}
	ErrOrderTerminal = &ApplicationError{
		ErrorCode:    ErrCodeOrderTerminal,
		ErrorMessage: "this order is closed and can no longer be changed",
		HttpCode:     http.StatusConflict,
	}
	// ErrOrderNotYours is returned when a guest token asks for an order belonging to a
	// different session. 404, not 403: confirming the order exists would let someone
	// enumerate other tables' orders (DECISIONS.md D4).
	ErrOrderNotYours = &ApplicationError{
		ErrorCode:    ErrCodeOrderNotYours,
		ErrorMessage: "order not found",
		HttpCode:     http.StatusNotFound,
	}
	// ErrOrderCancelTooLate is the guest cancel window closing (DECISIONS.md D6).
	ErrOrderCancelTooLate = &ApplicationError{
		ErrorCode:    ErrCodeOrderCancelTooLate,
		ErrorMessage: "the kitchen has already started this order, please ask staff to cancel it",
		HttpCode:     http.StatusConflict,
	}
	// ErrOrderEditNotAllowed states the deliberate v1 limitation (DECISIONS.md D6) and
	// points at the workaround, which is placing a second order.
	ErrOrderEditNotAllowed = &ApplicationError{
		ErrorCode:    ErrCodeOrderEditNotAllowed,
		ErrorMessage: "orders cannot be edited once placed, please place another order",
		HttpCode:     http.StatusConflict,
	}
	ErrOrderUpdateFailed = &ApplicationError{
		ErrorCode:    ErrCodeOrderUpdateFailed,
		ErrorMessage: "failed to update the order",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrOrderQuantityInvalid = &ApplicationError{
		ErrorCode:    ErrCodeOrderQuantityInvalid,
		ErrorMessage: "item quantity must be between 1 and 99",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	// ErrOrderTooManyItems bounds the request size. Without a cap, a crafted cart with
	// 50,000 lines becomes a cheap way to tie up a database transaction.
	ErrOrderTooManyItems = &ApplicationError{
		ErrorCode:    ErrCodeOrderTooManyItems,
		ErrorMessage: "an order can contain at most 50 different items",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	// ErrOrderReasonRequired enforces a reason on reject and staff-cancel, so the diner
	// gets told why rather than watching their order vanish.
	ErrOrderReasonRequired = &ApplicationError{
		ErrorCode:    ErrCodeOrderReasonRequired,
		ErrorMessage: "please give a reason so the customer can be told",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrOrderNumberFailed = &ApplicationError{
		ErrorCode:    ErrCodeOrderNumberFailed,
		ErrorMessage: "we could not place your order, please try again",
		HttpCode:     http.StatusInternalServerError,
	}
)
