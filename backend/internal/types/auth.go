package types

import "time"

// RequestStaffLogin is the admin panel's login body.
type RequestStaffLogin struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=1"`
}

// ResponseStaffLogin carries the issued tokens and the signed-in staff member.
type ResponseStaffLogin struct {
	AccessToken  string            `json:"access_token"`
	RefreshToken string            `json:"refresh_token"`
	ExpiresAt    time.Time         `json:"expires_at"`
	Staff        StaffMember       `json:"staff"`
	Restaurant   RestaurantSummary `json:"restaurant"`
}

// RequestRefreshToken exchanges a refresh token for a new access token.
type RequestRefreshToken struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// ResponseRefreshToken carries the replacement access token.
type ResponseRefreshToken struct {
	AccessToken string    `json:"access_token"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// StaffMember is a staff user as the API returns it. There is no password field of any
// kind, by construction rather than by remembering to strip one.
type StaffMember struct {
	UID         string     `json:"uid"`
	Name        string     `json:"name"`
	Email       string     `json:"email"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// RequestCreateStaff creates a new admin login. Owner-only.
type RequestCreateStaff struct {
	Name     string `json:"name" binding:"required,min=1,max=128"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8,max=128"`
	Role     string `json:"role" binding:"required,oneof=owner manager staff"`
}

// RequestUpdateStaff patches a staff member. Pointer fields distinguish "not supplied"
// from "set to empty", so a PATCH that omits a field leaves it alone.
type RequestUpdateStaff struct {
	Name   *string `json:"name,omitempty" binding:"omitempty,min=1,max=128"`
	Role   *string `json:"role,omitempty" binding:"omitempty,oneof=owner manager staff"`
	Status *string `json:"status,omitempty" binding:"omitempty,oneof=active inactive"`
}

// RequestChangePassword changes the caller's own password.
type RequestChangePassword struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=8,max=128"`
}

// ResponseStaffList is the staff management list.
type ResponseStaffList struct {
	Staff []StaffMember `json:"staff"`
}
