package response

import "net/http"

// Dish photograph upload failures (DECISIONS.md D15).
const (
	ErrCodeImageUploadsDisabled ErrorCode = "TX_IMG_001"
	ErrCodeImageTypeUnsupported ErrorCode = "TX_IMG_002"
	ErrCodeImageTooLarge        ErrorCode = "TX_IMG_003"
	ErrCodeImageNotUploaded     ErrorCode = "TX_IMG_004"
	ErrCodeImageKeyRejected     ErrorCode = "TX_IMG_005"
	ErrCodeImageContentRejected ErrorCode = "TX_IMG_006"
	ErrCodeImageUploadFailed    ErrorCode = "TX_IMG_007"
	ErrCodeImageAttachFailed    ErrorCode = "TX_IMG_008"
	ErrCodeImageRemoveFailed    ErrorCode = "TX_IMG_009"
)

var (
	// ErrImageUploadsDisabled fires on a deployment with no object store configured.
	//
	// 501 rather than 500 or 503, because all three would be wrong in a way that matters to
	// whoever is paged: nothing has failed and nothing is temporarily down. This deployment
	// does not implement hosted images, and the fix is configuration, not a restart. The
	// admin panel reads the same fact from `image_upload_enabled` on the menu response and
	// hides the control, so a manager should never see this.
	ErrImageUploadsDisabled = &ApplicationError{
		ErrorCode:    ErrCodeImageUploadsDisabled,
		ErrorMessage: "photo uploads are not configured on this deployment",
		HttpCode:     http.StatusNotImplemented,
	}
	ErrImageTypeUnsupported = &ApplicationError{
		ErrorCode:    ErrCodeImageTypeUnsupported,
		ErrorMessage: "a photo must be a JPEG, PNG or WebP",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrImageTooLarge = &ApplicationError{
		ErrorCode:    ErrCodeImageTooLarge,
		ErrorMessage: "that photo is too large",
		HttpCode:     http.StatusRequestEntityTooLarge,
	}
	// ErrImageNotUploaded means confirm was called for an object that is not in the bucket.
	//
	// The ordinary cause is not an attack but a failed upload: the browser's PUT was
	// interrupted, or the presigned URL expired while the manager was on restaurant wifi.
	// The message says "try again" because trying again is genuinely the fix.
	ErrImageNotUploaded = &ApplicationError{
		ErrorCode:    ErrCodeImageNotUploaded,
		ErrorMessage: "the photo did not finish uploading -- please try again",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	// ErrImageKeyRejected fires when a supplied object key is malformed, or is well-formed
	// but names another restaurant or another dish.
	//
	// One code for both, on purpose. Distinguishing them would tell a caller probing keys
	// which of their guesses was structurally right, and there is no legitimate client that
	// ever sends a key it was not just handed.
	ErrImageKeyRejected = &ApplicationError{
		ErrorCode:    ErrCodeImageKeyRejected,
		ErrorMessage: "that upload does not belong to this dish",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	// ErrImageContentRejected fires when the uploaded bytes are not the image they claimed
	// to be -- an HTML document sent as image/jpeg, most usefully.
	ErrImageContentRejected = &ApplicationError{
		ErrorCode:    ErrCodeImageContentRejected,
		ErrorMessage: "that file is not a valid JPEG, PNG or WebP image",
		HttpCode:     http.StatusUnprocessableEntity,
	}
	ErrImageUploadFailed = &ApplicationError{
		ErrorCode:    ErrCodeImageUploadFailed,
		ErrorMessage: "failed to start the photo upload",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrImageAttachFailed = &ApplicationError{
		ErrorCode:    ErrCodeImageAttachFailed,
		ErrorMessage: "failed to attach the photo",
		HttpCode:     http.StatusInternalServerError,
	}
	ErrImageRemoveFailed = &ApplicationError{
		ErrorCode:    ErrCodeImageRemoveFailed,
		ErrorMessage: "failed to remove the photo",
		HttpCode:     http.StatusInternalServerError,
	}
)
