package response

import "net/http"

// Rating and review failures.
const (
	ErrCodeReviewWindowClosed      ErrorCode = "TX_REV_001"
	ErrCodeReviewInvalidRating     ErrorCode = "TX_REV_002"
	ErrCodeReviewInvalidTag        ErrorCode = "TX_REV_003"
	ErrCodeReviewItemNotFound      ErrorCode = "TX_REV_004"
	ErrCodeReviewItemCancelled     ErrorCode = "TX_REV_005"
	ErrCodeReviewSaveFailed        ErrorCode = "TX_REV_006"
	ErrCodeReviewFetchFailed       ErrorCode = "TX_REV_007"
	ErrCodeReviewTooManyTags       ErrorCode = "TX_REV_008"
	ErrCodeReviewInvalidServiceTag ErrorCode = "TX_REV_009"
	ErrCodeReviewServiceSaveFailed ErrorCode = "TX_REV_010"
)

var (
	// ErrReviewWindowClosed covers both ends of the window: too early, because the kitchen
	// has not got the food to the table yet, and too late, because the order is a day old.
	//
	// 409 rather than 403: the request was well formed and would have been legal at another
	// moment. The diner app reacts by refetching -- can_review tells it which end it hit --
	// rather than showing an authorisation error to someone who is simply early.
	ErrReviewWindowClosed = &ApplicationError{
		ErrorCode:    ErrCodeReviewWindowClosed,
		ErrorMessage: "this order cannot be rated right now",
		HttpCode:     http.StatusConflict,
	}
	ErrReviewInvalidRating = &ApplicationError{
		ErrorCode:    ErrCodeReviewInvalidRating,
		ErrorMessage: "a rating must be between 1 and 5",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	// ErrReviewInvalidTag is a rejection rather than a silent drop. The whole value of a
	// closed vocabulary is that every stored tag can be counted; quietly discarding an
	// unrecognised one would let a client ship a typo that looks like it works and produces
	// a tag count nobody can explain.
	ErrReviewInvalidTag = &ApplicationError{
		ErrorCode:    ErrCodeReviewInvalidTag,
		ErrorMessage: "that is not a rating tag this app recognises",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrReviewTooManyTags = &ApplicationError{
		ErrorCode:    ErrCodeReviewTooManyTags,
		ErrorMessage: "too many tags on one rating",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	// ErrReviewItemNotFound is returned when the line uid names nothing on this order. 404,
	// matching ErrOrderNotYours: an item uid is as enumerable as an order uid, and confirming
	// one exists elsewhere would leak another table's bill line by line (DECISIONS.md D4).
	ErrReviewItemNotFound = &ApplicationError{
		ErrorCode:    ErrCodeReviewItemNotFound,
		ErrorMessage: "that dish is not on this order",
		HttpCode:     http.StatusNotFound,
	}
	// ErrReviewItemCancelled refuses a rating on a line the kitchen voided. The diner never
	// received it, so a star on it would describe nothing (PRD 9.1).
	ErrReviewItemCancelled = &ApplicationError{
		ErrorCode:    ErrCodeReviewItemCancelled,
		ErrorMessage: "this dish was cancelled, so there is nothing to rate",
		HttpCode:     http.StatusConflict,
	}
	ErrReviewSaveFailed = &ApplicationError{
		ErrorCode:    ErrCodeReviewSaveFailed,
		ErrorMessage: "we could not save your rating, please try again",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrReviewFetchFailed = &ApplicationError{
		ErrorCode:    ErrCodeReviewFetchFailed,
		ErrorMessage: "failed to load reviews",
		HttpCode:     http.StatusInternalServerError,
	}
	// ErrReviewInvalidServiceTag is the service vocabulary's refusal. A DISTINCT code from
	// ErrCodeReviewInvalidTag, so a client sending a dish tag to the service endpoint is told
	// which vocabulary it got wrong rather than left to guess between two closed sets.
	//
	// Named by constant rather than by its literal string on purpose: CONTRIBUTING.md tells
	// contributors to check for collisions with a grep over this package's raw text, and a code
	// quoted in a comment would show up as a false duplicate.
	ErrReviewInvalidServiceTag = &ApplicationError{
		ErrorCode:    ErrCodeReviewInvalidServiceTag,
		ErrorMessage: "that is not a service tag this app recognises",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrReviewServiceSaveFailed = &ApplicationError{
		ErrorCode:    ErrCodeReviewServiceSaveFailed,
		ErrorMessage: "we could not save your rating, please try again",
		HttpCode:     http.StatusInternalServerError,
	}
)
