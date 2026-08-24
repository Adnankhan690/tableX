package response

import "net/http"

// Staff authentication and guest session failures.
const (
	ErrCodeInvalidCredentials ErrorCode = "TX_AUT_001"
	ErrCodeTokenMissing       ErrorCode = "TX_AUT_002"
	ErrCodeTokenInvalid       ErrorCode = "TX_AUT_003"
	ErrCodeTokenExpired       ErrorCode = "TX_AUT_004"
	ErrCodeStaffInactive      ErrorCode = "TX_AUT_005"
	ErrCodeInsufficientRole   ErrorCode = "TX_AUT_006"
	ErrCodeEmailTaken         ErrorCode = "TX_AUT_007"
	ErrCodeWeakPassword       ErrorCode = "TX_AUT_008"
	// ErrCodePlatformTokenInvalid covers a missing, malformed or wrong platform token. One
	// code for all three, unlike the missing/invalid pair above for staff tokens: there is
	// exactly one caller of the platform surface -- whoever runs the deployment -- and telling
	// them which of "no token" and "wrong token" applies helps an attacker more than it helps
	// them. (Written without the literal codes so the duplicate-code grep in
	// docs/CONTRIBUTING.md does not report this comment as a clash.)
	ErrCodePlatformTokenInvalid ErrorCode = "TX_AUT_009"

	ErrCodeSessionMissing ErrorCode = "TX_SES_001"
	ErrCodeSessionInvalid ErrorCode = "TX_SES_002"
	ErrCodeSessionExpired ErrorCode = "TX_SES_003"
)

var (
	// ErrInvalidCredentials is returned for both an unknown email and a wrong password.
	//
	// One message for both on purpose: distinguishing them tells an attacker which staff
	// emails exist at a restaurant, which is the first half of a credential-stuffing run.
	ErrInvalidCredentials = &ApplicationError{
		ErrorCode:    ErrCodeInvalidCredentials,
		ErrorMessage: "incorrect email or password",
		HttpCode:     http.StatusUnauthorized,
	}
	ErrTokenMissing = &ApplicationError{
		ErrorCode:    ErrCodeTokenMissing,
		ErrorMessage: "authentication required",
		HttpCode:     http.StatusUnauthorized,
	}
	ErrTokenInvalid = &ApplicationError{
		ErrorCode:    ErrCodeTokenInvalid,
		ErrorMessage: "your session is not valid",
		HttpCode:     http.StatusUnauthorized,
	}
	// ErrTokenExpired is distinct from ErrTokenInvalid so the admin panel can refresh
	// silently on expiry instead of bouncing the user to the login screen mid-service.
	ErrTokenExpired = &ApplicationError{
		ErrorCode:    ErrCodeTokenExpired,
		ErrorMessage: "your session has expired, please sign in again",
		HttpCode:     http.StatusUnauthorized,
	}
	ErrStaffInactive = &ApplicationError{
		ErrorCode:    ErrCodeStaffInactive,
		ErrorMessage: "this account has been deactivated",
		HttpCode:     http.StatusForbidden,
	}
	ErrInsufficientRole = &ApplicationError{
		ErrorCode:    ErrCodeInsufficientRole,
		ErrorMessage: "your role does not permit this action",
		HttpCode:     http.StatusForbidden,
	}
	ErrEmailTaken = &ApplicationError{
		ErrorCode:    ErrCodeEmailTaken,
		ErrorMessage: "a staff member with this email already exists",
		HttpCode:     http.StatusConflict,
	}
	ErrWeakPassword = &ApplicationError{
		ErrorCode:    ErrCodeWeakPassword,
		ErrorMessage: "password must be at least 8 characters",
		HttpCode:     http.StatusUnprocessableEntity,
	}

	// ErrPlatformTokenInvalid guards the operator surface (DECISIONS.md D14).
	//
	// The message deliberately does not say whether onboarding is enabled on this deployment.
	// When it is not, the group is never mounted and gin answers 404 -- so a 401 here already
	// means "the endpoint exists", and there is nothing to gain from confirming more.
	ErrPlatformTokenInvalid = &ApplicationError{
		ErrorCode:    ErrCodePlatformTokenInvalid,
		ErrorMessage: "a valid platform token is required",
		HttpCode:     http.StatusUnauthorized,
	}

	ErrSessionMissing = &ApplicationError{
		ErrorCode:    ErrCodeSessionMissing,
		ErrorMessage: "scan the QR code on your table to start ordering",
		HttpCode:     http.StatusUnauthorized,
	}
	ErrSessionInvalid = &ApplicationError{
		ErrorCode:    ErrCodeSessionInvalid,
		ErrorMessage: "this ordering session is not valid, please scan the QR code again",
		HttpCode:     http.StatusUnauthorized,
	}
	// ErrSessionExpired gets an actionable message, not a technical one: the diner is
	// sitting at a table holding a phone, and "scan again" is the entire fix.
	ErrSessionExpired = &ApplicationError{
		ErrorCode:    ErrCodeSessionExpired,
		ErrorMessage: "this ordering session has expired, please scan the QR code again",
		HttpCode:     http.StatusUnauthorized,
	}
)
