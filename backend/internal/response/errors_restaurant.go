package response

import "net/http"

// Restaurant, table and QR failures.
const (
	ErrCodeRestaurantNotFound     ErrorCode = "TX_RST_001"
	ErrCodeRestaurantInactive     ErrorCode = "TX_RST_002"
	ErrCodeRestaurantSlugTaken    ErrorCode = "TX_RST_003"
	ErrCodeRestaurantUpdateFailed ErrorCode = "TX_RST_004"
	ErrCodeRestaurantCreateFailed ErrorCode = "TX_RST_005"
	ErrCodeRestaurantFetchFailed  ErrorCode = "TX_RST_006"
	ErrCodeUPINotConfigured       ErrorCode = "TX_RST_007"

	ErrCodeTableNotFound      ErrorCode = "TX_TBL_001"
	ErrCodeTableInactive      ErrorCode = "TX_TBL_002"
	ErrCodeTableLabelTaken    ErrorCode = "TX_TBL_003"
	ErrCodeQRTokenInvalid     ErrorCode = "TX_TBL_004"
	ErrCodeTableCreateFailed  ErrorCode = "TX_TBL_005"
	ErrCodeTableUpdateFailed  ErrorCode = "TX_TBL_006"
	ErrCodeTableFetchFailed   ErrorCode = "TX_TBL_007"
	ErrCodeTableHasLiveOrders ErrorCode = "TX_TBL_008"
	ErrCodeQRRenderFailed     ErrorCode = "TX_TBL_009"
)

var (
	ErrRestaurantNotFound = &ApplicationError{
		ErrorCode:    ErrCodeRestaurantNotFound,
		ErrorMessage: "restaurant not found",
		HttpCode:     http.StatusNotFound,
	}
	ErrRestaurantInactive = &ApplicationError{
		ErrorCode:    ErrCodeRestaurantInactive,
		ErrorMessage: "this restaurant is not currently accepting orders",
		HttpCode:     http.StatusForbidden,
	}
	ErrRestaurantSlugTaken = &ApplicationError{
		ErrorCode:    ErrCodeRestaurantSlugTaken,
		ErrorMessage: "that restaurant URL is already in use",
		HttpCode:     http.StatusConflict,
	}
	ErrRestaurantCreateFailed = &ApplicationError{
		ErrorCode:    ErrCodeRestaurantCreateFailed,
		ErrorMessage: "failed to create restaurant",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrRestaurantUpdateFailed = &ApplicationError{
		ErrorCode:    ErrCodeRestaurantUpdateFailed,
		ErrorMessage: "failed to update restaurant",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrRestaurantFetchFailed = &ApplicationError{
		ErrorCode:    ErrCodeRestaurantFetchFailed,
		ErrorMessage: "failed to load restaurant",
		HttpCode:     http.StatusInternalServerError,
	}
	// ErrUPINotConfigured fires when a diner picks Pay via QR at a restaurant whose VPA
	// was never filled in. A 409 rather than a 500: nothing is broken, the restaurant just
	// has not finished setup, and the diner can still pay at the counter.
	ErrUPINotConfigured = &ApplicationError{
		ErrorCode:    ErrCodeUPINotConfigured,
		ErrorMessage: "online payment is not set up for this restaurant, please pay at the counter",
		HttpCode:     http.StatusConflict,
	}

	ErrTableNotFound = &ApplicationError{
		ErrorCode:    ErrCodeTableNotFound,
		ErrorMessage: "table not found",
		HttpCode:     http.StatusNotFound,
	}
	ErrTableInactive = &ApplicationError{
		ErrorCode:    ErrCodeTableInactive,
		ErrorMessage: "this table is not currently taking orders",
		HttpCode:     http.StatusForbidden,
	}
	ErrTableLabelTaken = &ApplicationError{
		ErrorCode:    ErrCodeTableLabelTaken,
		ErrorMessage: "a table with this label already exists",
		HttpCode:     http.StatusConflict,
	}
	// ErrQRTokenInvalid is what a diner sees for a peeled-off, superseded, or mistyped QR.
	// The message points at the recovery path rather than naming the token.
	ErrQRTokenInvalid = &ApplicationError{
		ErrorCode:    ErrCodeQRTokenInvalid,
		ErrorMessage: "this QR code is no longer valid, please ask staff for help",
		HttpCode:     http.StatusNotFound,
	}
	ErrTableCreateFailed = &ApplicationError{
		ErrorCode:    ErrCodeTableCreateFailed,
		ErrorMessage: "failed to create table",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrTableUpdateFailed = &ApplicationError{
		ErrorCode:    ErrCodeTableUpdateFailed,
		ErrorMessage: "failed to update table",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrTableFetchFailed = &ApplicationError{
		ErrorCode:    ErrCodeTableFetchFailed,
		ErrorMessage: "failed to load tables",
		HttpCode:     http.StatusInternalServerError,
	}
	// ErrTableHasLiveOrders blocks archiving a table mid-service, which would orphan an
	// order the kitchen is still cooking.
	ErrTableHasLiveOrders = &ApplicationError{
		ErrorCode:    ErrCodeTableHasLiveOrders,
		ErrorMessage: "this table has live orders and cannot be removed yet",
		HttpCode:     http.StatusConflict,
	}
	ErrQRRenderFailed = &ApplicationError{
		ErrorCode:    ErrCodeQRRenderFailed,
		ErrorMessage: "failed to render QR code",
		HttpCode:     http.StatusInternalServerError,
	}
)
