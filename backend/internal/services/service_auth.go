package services

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"tablex/internal/mailer"
	"tablex/internal/models"
	"tablex/internal/response"
	"tablex/internal/types"
	"tablex/internal/utils"
)

// Token kinds, carried in the "typ" claim.
//
// The distinction is load-bearing: a refresh token is long-lived, so accepting one as an
// access token would silently remove the short expiry that limits the damage from a stolen
// token. Authenticate rejects anything that is not an access token.
const (
	tokenTypeAccess  = "access"
	tokenTypeRefresh = "refresh"
)

// dummyBcryptHash is compared against when no staff row matches a login attempt.
//
// Without it, a missing email returns in microseconds while a wrong password takes the full
// bcrypt cost, and the difference is measurable over the network -- which hands an attacker
// a way to enumerate which staff emails exist at a restaurant. This is a real hash of a
// value nobody knows, so the comparison does the same work and always fails.
var dummyBcryptHash = []byte("$2a$12$HN06UaxL9rImoi8Vd4.BveoYpYT3Hp9Gx5Ox9aN36lBtA7lRP1O/q")

// staffClaims is the JWT payload.
//
// It carries everything StaffPrincipal needs, which is what lets Authenticate do no database
// work on the happy path -- and that matters because it runs on every single admin request.
type staffClaims struct {
	jwt.RegisteredClaims
	TokenType     string `json:"typ"`
	StaffID       int32  `json:"sid"`
	StaffUID      string `json:"suid"`
	RestaurantID  int32  `json:"rid"`
	RestaurantUID string `json:"ruid"`
	Role          string `json:"role"`
}

type serviceAuth struct {
	Access *ServiceAccess
}

// NewServiceAuth builds the staff authentication service.
func NewServiceAuth(access *ServiceAccess) ServiceAuthMethods {
	return &serviceAuth{Access: access}
}

func (s *serviceAuth) Login(
	ctx context.Context,
	req *types.RequestStaffLogin,
) (*types.ResponseStaffLogin, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)
	email := normalizeEmail(req.Email)

	matches, err := s.Access.Repositories.Staff.GetByEmailAnyRestaurant(ctx, email)
	if err != nil {
		log.Errorf("[Login] lookup failed for %q: %+v", email, err)
		return nil, response.ErrInternal
	}

	// Exactly one match is required. Zero is an unknown email; more than one means the same
	// address staffs two restaurants on this platform, and there is no way to know which the
	// person meant -- signing them into whichever row sorted first would be worse than
	// refusing.
	if len(matches) != 1 {
		// Burn the same bcrypt cost before answering, so timing does not distinguish this
		// branch from a wrong password.
		_ = bcrypt.CompareHashAndPassword(dummyBcryptHash, []byte(req.Password))
		if len(matches) > 1 {
			log.Warnf("[Login] ambiguous login: %q exists at %d restaurants", email, len(matches))
		}
		return nil, response.ErrInvalidCredentials
	}

	staff := matches[0]

	if err := bcrypt.CompareHashAndPassword([]byte(staff.PasswordHash), []byte(req.Password)); err != nil {
		log.Warnf("[Login] wrong password for staff_uid=%s", staff.UID)
		return nil, response.ErrInvalidCredentials
	}

	// Checked after the password, not before: answering "this account is deactivated" to
	// someone who did not prove they own it leaks that the account exists.
	if !staff.IsActive() {
		return nil, response.ErrStaffInactive
	}

	restaurant, err := s.Access.Repositories.Restaurant.GetByID(ctx, staff.RestaurantID)
	if err != nil {
		log.Errorf("[Login] restaurant %d missing for staff %s: %+v", staff.RestaurantID, staff.UID, err)
		return nil, response.ErrInternal
	}
	if restaurant.Status != models.EntityStatusActive {
		return nil, response.ErrRestaurantInactive
	}

	access, expiresAt, appErr := s.issueToken(staff, restaurant, tokenTypeAccess)
	if appErr != nil {
		return nil, appErr
	}
	refresh, _, appErr := s.issueToken(staff, restaurant, tokenTypeRefresh)
	if appErr != nil {
		return nil, appErr
	}

	// Telemetry, not part of the login contract: a failure to stamp the timestamp must not
	// stop a staff member signing in during service.
	if err := s.Access.Repositories.Staff.TouchLastLogin(ctx, staff.ID, time.Now().UTC()); err != nil {
		log.Warnf("[Login] could not update last_login_at for %s: %+v", staff.UID, err)
	}

	log.Infof("[Login] staff_uid=%s role=%s restaurant_uid=%s", staff.UID, staff.Role, restaurant.UID)

	return &types.ResponseStaffLogin{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresAt:    expiresAt,
		Staff:        toStaffMember(staff),
		Restaurant:   toRestaurantSummary(restaurant),
	}, nil
}

func (s *serviceAuth) Refresh(
	ctx context.Context,
	req *types.RequestRefreshToken,
) (*types.ResponseRefreshToken, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	claims, appErr := s.parseToken(req.RefreshToken, tokenTypeRefresh)
	if appErr != nil {
		return nil, appErr
	}

	// Unlike Authenticate, refresh does hit the database. It is rare, and it is the only
	// opportunity to notice that an account was deactivated or deleted since the long-lived
	// refresh token was issued -- otherwise a sacked staff member keeps working access for
	// the full refresh lifetime.
	staff, err := s.Access.Repositories.Staff.GetByID(ctx, claims.StaffID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrTokenInvalid
		}
		if response.IsClientGone(err) {
			log.Debugf("[Refresh] client disconnected mid-refresh")
			return nil, response.ErrClientClosed
		}
		log.Errorf("[Refresh] staff lookup failed: %+v", err)
		return nil, response.ErrInternal
	}
	if !staff.IsActive() {
		return nil, response.ErrStaffInactive
	}

	restaurant, err := s.Access.Repositories.Restaurant.GetByID(ctx, staff.RestaurantID)
	if err != nil {
		log.Errorf("[Refresh] restaurant lookup failed: %+v", err)
		return nil, response.ErrInternal
	}

	token, expiresAt, appErr := s.issueToken(staff, restaurant, tokenTypeAccess)
	if appErr != nil {
		return nil, appErr
	}

	return &types.ResponseRefreshToken{AccessToken: token, ExpiresAt: expiresAt}, nil
}

// Authenticate validates a bearer token and builds the principal.
//
// Deliberately does no database work: the claims carry the staff id, restaurant id and role,
// and this runs on every admin request. A lookup here would put a query in front of the
// entire admin panel for no additional safety -- deactivation is caught at refresh time
// instead, which bounds the exposure to one access-token lifetime.
func (s *serviceAuth) Authenticate(
	_ context.Context,
	bearer string,
) (*StaffPrincipal, *response.ApplicationError) {
	raw := stripBearer(bearer)
	if raw == "" {
		return nil, response.ErrTokenMissing
	}

	claims, appErr := s.parseToken(raw, tokenTypeAccess)
	if appErr != nil {
		return nil, appErr
	}

	role := models.StaffRole(claims.Role)
	if !role.Valid() {
		return nil, response.ErrTokenInvalid
	}

	return &StaffPrincipal{
		StaffID:       claims.StaffID,
		StaffUID:      claims.StaffUID,
		RestaurantID:  claims.RestaurantID,
		RestaurantUID: claims.RestaurantUID,
		Role:          role,
	}, nil
}

func (s *serviceAuth) Me(
	ctx context.Context,
	actor *StaffPrincipal,
) (*types.StaffMember, *response.ApplicationError) {
	staff, appErr := s.loadStaff(ctx, actor.RestaurantID, actor.StaffUID)
	if appErr != nil {
		return nil, appErr
	}
	member := toStaffMember(staff)
	return &member, nil
}

func (s *serviceAuth) ListStaff(
	ctx context.Context,
	actor *StaffPrincipal,
) (*types.ResponseStaffList, *response.ApplicationError) {
	rows, err := s.Access.Repositories.Staff.ListByRestaurant(ctx, actor.RestaurantID)
	if err != nil {
		s.Access.Logger.With(ctx).Errorf("[ListStaff] %+v", err)
		return nil, response.ErrInternal
	}

	members := make([]types.StaffMember, 0, len(rows))
	for _, row := range rows {
		members = append(members, toStaffMember(row))
	}
	return &types.ResponseStaffList{Staff: members}, nil
}

func (s *serviceAuth) CreateStaff(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestCreateStaff,
) (*types.StaffMember, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageStaff() {
		return nil, response.ErrInsufficientRole
	}

	role := models.StaffRole(req.Role)
	if !role.Valid() {
		return nil, response.ErrInsufficientRole.WithMessage("role must be owner, manager or staff")
	}

	email := normalizeEmail(req.Email)

	existing, err := s.Access.Repositories.Staff.GetByEmail(ctx, actor.RestaurantID, email)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Errorf("[CreateStaff] duplicate check failed: %+v", err)
		return nil, response.ErrInternal
	}
	if existing != nil {
		return nil, response.ErrEmailTaken
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), s.Access.Cfg.Auth.BcryptCost)
	if err != nil {
		log.Errorf("[CreateStaff] hashing failed: %+v", err)
		return nil, response.ErrInternal
	}

	staff := &models.StaffUser{
		UID:          utils.GenerateUID(utils.UIDPrefixStaff),
		RestaurantID: actor.RestaurantID,
		Email:        email,
		PasswordHash: string(hash),
		Name:         strings.TrimSpace(req.Name),
		Role:         role,
		Status:       models.EntityStatusActive,
	}

	if err := s.Access.Repositories.Staff.Create(ctx, nil, staff); err != nil {
		log.Errorf("[CreateStaff] insert failed: %+v", err)
		return nil, response.ErrInternal
	}

	log.Infof("[CreateStaff] created staff_uid=%s role=%s by %s", staff.UID, staff.Role, actor.StaffUID)

	member := toStaffMember(staff)
	return &member, nil
}

func (s *serviceAuth) UpdateStaff(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
	req *types.RequestUpdateStaff,
) (*types.StaffMember, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageStaff() {
		return nil, response.ErrInsufficientRole
	}

	target, appErr := s.loadStaff(ctx, actor.RestaurantID, uid)
	if appErr != nil {
		return nil, appErr
	}

	fields := map[string]any{}
	applyString(fields, "name", req.Name)
	if req.Role != nil {
		role := models.StaffRole(*req.Role)
		if !role.Valid() {
			return nil, response.ErrInsufficientRole.WithMessage("role must be owner, manager or staff")
		}
		fields["role"] = role
	}
	if req.Status != nil {
		fields["status"] = models.EntityStatus(*req.Status)
	}

	if len(fields) == 0 {
		member := toStaffMember(target)
		return &member, nil
	}

	// Guard against locking every human out of the restaurant.
	//
	// Demoting or deactivating the last active owner leaves nobody able to manage staff,
	// which is unrecoverable without direct database access. Checked here rather than trusted
	// to the caller, because the admin UI cannot know the count reliably.
	if s.wouldRemoveLastOwner(target, fields) {
		count, err := s.Access.Repositories.Staff.CountByRole(ctx, actor.RestaurantID, models.StaffRoleOwner)
		if err != nil {
			log.Errorf("[UpdateStaff] owner count failed: %+v", err)
			return nil, response.ErrInternal
		}
		if count <= 1 {
			return nil, response.ErrInsufficientRole.WithMessage(
				"this is the only owner -- promote another owner before changing this account")
		}
	}

	updated, err := s.Access.Repositories.Staff.UpdateFields(ctx, target.ID, fields)
	if err != nil {
		log.Errorf("[UpdateStaff] update failed for %s: %+v", uid, err)
		return nil, response.ErrInternal
	}

	log.Infof("[UpdateStaff] staff_uid=%s updated by %s", uid, actor.StaffUID)

	member := toStaffMember(updated)
	return &member, nil
}

// wouldRemoveLastOwner reports whether this patch strips owner status from an owner.
func (s *serviceAuth) wouldRemoveLastOwner(target *models.StaffUser, fields map[string]any) bool {
	if target.Role != models.StaffRoleOwner || target.Status != models.EntityStatusActive {
		return false
	}
	if role, ok := fields["role"].(models.StaffRole); ok && role != models.StaffRoleOwner {
		return true
	}
	if status, ok := fields["status"].(models.EntityStatus); ok && status != models.EntityStatusActive {
		return true
	}
	return false
}

func (s *serviceAuth) ChangePassword(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestChangePassword,
) *response.ApplicationError {
	log := s.Access.Logger.With(ctx)

	staff, appErr := s.loadStaff(ctx, actor.RestaurantID, actor.StaffUID)
	if appErr != nil {
		return appErr
	}

	// The current password is required even though the caller is already authenticated: it is
	// what stops a walked-away-from tablet being used to lock the real owner out of their own
	// account.
	if err := bcrypt.CompareHashAndPassword([]byte(staff.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		return response.ErrInvalidCredentials.WithMessage("your current password is incorrect")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), s.Access.Cfg.Auth.BcryptCost)
	if err != nil {
		log.Errorf("[ChangePassword] hashing failed: %+v", err)
		return response.ErrInternal
	}

	if _, err := s.Access.Repositories.Staff.UpdateFields(ctx, staff.ID, map[string]any{
		"password_hash": string(hash),
	}); err != nil {
		log.Errorf("[ChangePassword] update failed: %+v", err)
		return response.ErrInternal
	}

	log.Infof("[ChangePassword] staff_uid=%s changed their password", staff.UID)
	return nil
}

// loadStaff fetches a staff row scoped to the caller's restaurant.
func (s *serviceAuth) loadStaff(
	ctx context.Context,
	restaurantID int32,
	uid string,
) (*models.StaffUser, *response.ApplicationError) {
	staff, err := s.Access.Repositories.Staff.GetByUID(ctx, restaurantID, uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 404 rather than 403: confirming that a staff uid exists at another restaurant
			// would leak the platform's tenant contents.
			return nil, response.ErrNotFound.WithMessage("staff member not found")
		}
		s.Access.Logger.With(ctx).Errorf("[loadStaff] %+v", err)
		return nil, response.ErrInternal
	}
	return staff, nil
}

// issueToken signs a JWT of the given kind.
func (s *serviceAuth) issueToken(
	staff *models.StaffUser,
	restaurant *models.Restaurant,
	tokenType string,
) (string, time.Time, *response.ApplicationError) {
	ttl := s.Access.Cfg.Auth.AccessTokenTTL
	if tokenType == tokenTypeRefresh {
		ttl = s.Access.Cfg.Auth.RefreshTokenTTL
	}

	now := time.Now().UTC()
	expiresAt := now.Add(ttl)

	claims := staffClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   staff.UID,
			Issuer:    s.Access.Cfg.App.Name,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
		TokenType:     tokenType,
		StaffID:       staff.ID,
		StaffUID:      staff.UID,
		RestaurantID:  restaurant.ID,
		RestaurantUID: restaurant.UID,
		Role:          string(staff.Role),
	}

	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
		SignedString([]byte(s.Access.Cfg.Auth.JWTSecret))
	if err != nil {
		return "", time.Time{}, response.ErrInternal
	}
	return signed, expiresAt, nil
}

// parseToken verifies a token's signature, expiry and kind.
func (s *serviceAuth) parseToken(raw, wantType string) (*staffClaims, *response.ApplicationError) {
	claims := &staffClaims{}

	_, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		// Pinning the algorithm is not optional. Without it a token signed with "none", or an
		// RS256 token whose "public key" is our HMAC secret, would verify -- both are standard
		// JWT forgeries.
		if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, fmt.Errorf("unexpected signing method %q", token.Method.Alg())
		}
		return []byte(s.Access.Cfg.Auth.JWTSecret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))

	if err != nil {
		// Expiry is reported separately from invalidity so the admin panel can refresh
		// silently instead of bouncing a staff member to the login screen mid-service.
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, response.ErrTokenExpired
		}
		return nil, response.ErrTokenInvalid
	}

	if claims.TokenType != wantType {
		return nil, response.ErrTokenInvalid
	}
	if claims.StaffUID == "" || claims.RestaurantID == 0 {
		return nil, response.ErrTokenInvalid
	}
	return claims, nil
}

// stripBearer extracts the token from an Authorization header value, tolerating a bare token
// and a case-varying scheme.
func stripBearer(header string) string {
	value := strings.TrimSpace(header)
	if value == "" {
		return ""
	}
	if len(value) >= 7 && strings.EqualFold(value[:7], "bearer ") {
		return strings.TrimSpace(value[7:])
	}
	return value
}

func (s *serviceAuth) ForgotPassword(ctx context.Context, email string) *response.ApplicationError {
	log := s.Access.Logger.With(ctx)
	normalized := normalizeEmail(email)

	// Retrieve matching staff users across all tenants/restaurants
	staffs, err := s.Access.Repositories.Staff.GetByEmailAnyRestaurant(ctx, normalized)
	if err != nil {
		log.Errorf("[ForgotPassword] email lookup failed: %+v", err)
		return response.ErrInternal
	}

	// For privacy & anti-enumeration, return success even if no user matches.
	if len(staffs) == 0 {
		log.Infof("[ForgotPassword] email %q not found, returning mock success", normalized)
		return nil
	}

	// Rate limiting: check if a code was already requested in the last 60 seconds
	lastCode, err := s.Access.Repositories.PasswordReset.GetLastActiveCode(ctx, normalized)
	if err != nil {
		log.Errorf("[ForgotPassword] check last active code failed: %+v", err)
		return response.ErrInternal
	}
	if lastCode != nil && time.Since(lastCode.CreatedAt) < 60*time.Second {
		return response.ErrInvalidRequest.WithMessage("Please wait 60 seconds before requesting another verification code.")
	}

	// Generate 6-digit cryptographically secure code
	var code string
	for i := 0; i < 6; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			log.Errorf("[ForgotPassword] generating code failed: %+v", err)
			return response.ErrInternal
		}
		code += fmt.Sprintf("%d", n.Int64())
	}

	// Create reset code in DB (expires in 15 minutes)
	resetCode := &models.PasswordResetCode{
		Email:     normalized,
		Code:      code,
		ExpiresAt: time.Now().UTC().Add(15 * time.Minute),
	}
	if err := s.Access.Repositories.PasswordReset.CreateCode(ctx, resetCode); err != nil {
		log.Errorf("[ForgotPassword] create code DB record failed: %+v", err)
		return response.ErrInternal
	}

	// The message itself. Sent through the shared mailer rather than a Brevo call written out
	// here: this was the only email in the application until the landing page's demo form
	// arrived, and two hand-rolled copies of the same provider call is two answers to "which
	// status codes mean it went" (internal/mailer).
	msg := mailer.Message{
		To:      []string{normalized},
		Subject: "Your tableX password reset verification code",
		HTML: fmt.Sprintf(`
			<html>
			<body style="font-family: sans-serif; padding: 20px; color: #333;">
				<h2>Password Reset Request</h2>
				<p>You requested a password reset for your tableX admin account.</p>
				<p>Your 6-digit verification code is:</p>
				<div style="font-size: 24px; font-weight: bold; background-color: #f3f4f6; padding: 15px; border-radius: 8px; display: inline-block; letter-spacing: 2px;">
					%s
				</div>
				<p>This code will expire in 15 minutes.</p>
				<p>If you did not make this request, you can safely ignore this email.</p>
			</body>
			</html>
		`, code),
	}

	// Sent synchronously and allowed to fail the request, unlike the demo notification, and the
	// asymmetry is the point. There the row IS the record and the email is a nudge; here the
	// email is the only way the code reaches the person who asked for it, so reporting success
	// after a failed send leaves a staff member waiting for something that is never coming.
	if err := s.Access.Mailer.Send(ctx, msg); err != nil {
		log.Errorf("[ForgotPassword] sending verification email failed: %v", err)
		return response.ErrInternal
	}

	log.Infof("[ForgotPassword] verification code sent to %q", normalized)
	return nil
}

func (s *serviceAuth) VerifyResetCode(ctx context.Context, email string, code string) *response.ApplicationError {
	log := s.Access.Logger.With(ctx)
	normalized := normalizeEmail(email)

	resetCode, err := s.Access.Repositories.PasswordReset.GetActiveCode(ctx, normalized, code)
	if err != nil {
		log.Errorf("[VerifyResetCode] DB query failed: %+v", err)
		return response.ErrInternal
	}
	if resetCode == nil {
		return response.ErrInvalidRequest.WithMessage("The verification code you entered is invalid or has expired.")
	}

	return nil
}

func (s *serviceAuth) ResetPassword(ctx context.Context, email string, code string, newPassword string) *response.ApplicationError {
	log := s.Access.Logger.With(ctx)
	normalized := normalizeEmail(email)

	resetCode, err := s.Access.Repositories.PasswordReset.GetActiveCode(ctx, normalized, code)
	if err != nil {
		log.Errorf("[ResetPassword] DB query failed: %+v", err)
		return response.ErrInternal
	}
	if resetCode == nil {
		return response.ErrInvalidRequest.WithMessage("The verification code you entered is invalid or has expired.")
	}

	if len(newPassword) < 8 {
		return response.ErrInvalidRequest.WithMessage("Password must be at least 8 characters long.")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), s.Access.Cfg.Auth.BcryptCost)
	if err != nil {
		log.Errorf("[ResetPassword] hashing failed: %+v", err)
		return response.ErrInternal
	}

	// Retrieve matches across all restaurants
	staffs, err := s.Access.Repositories.Staff.GetByEmailAnyRestaurant(ctx, normalized)
	if err != nil {
		log.Errorf("[ResetPassword] email lookup failed: %+v", err)
		return response.ErrInternal
	}

	for _, staff := range staffs {
		if _, err := s.Access.Repositories.Staff.UpdateFields(ctx, staff.ID, map[string]any{
			"password_hash": string(hash),
		}); err != nil {
			log.Errorf("[ResetPassword] update failed for staff id=%d: %+v", staff.ID, err)
			return response.ErrInternal
		}
	}

	if err := s.Access.Repositories.PasswordReset.MarkCodeUsed(ctx, resetCode.ID); err != nil {
		log.Warnf("[ResetPassword] failed to mark code used for id=%d: %+v", resetCode.ID, err)
	}

	log.Infof("[ResetPassword] password updated successfully for email %q across %d accounts", normalized, len(staffs))
	return nil
}
