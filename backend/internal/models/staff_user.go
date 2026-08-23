package models

import "time"

// StaffUser is an admin-panel login. It belongs to exactly one restaurant: v1 has no
// franchise view, so a token carries one tenant and the scope is enforced in middleware
// rather than remembered in each handler (DECISIONS.md D3).
type StaffUser struct {
	ID           int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID          string `gorm:"size:64;not null;unique" json:"uid"`
	RestaurantID int32  `gorm:"not null;index" json:"restaurant_id"`
	Email        string `gorm:"size:255;not null" json:"email"`
	// PasswordHash is bcrypt. json:"-" is load-bearing: this struct is returned from
	// repositories and must never serialise into a response by accident.
	PasswordHash string       `gorm:"size:255;not null" json:"-"`
	Name         string       `gorm:"size:128;not null" json:"name"`
	Role         StaffRole    `gorm:"size:32;not null;default:'staff'" json:"role"`
	Status       EntityStatus `gorm:"size:32;not null;default:'active'" json:"status"`
	LastLoginAt  *time.Time   `json:"last_login_at,omitempty"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`

	Restaurant *Restaurant `gorm:"foreignKey:RestaurantID" json:"restaurant,omitempty"`
}

func (StaffUser) TableName() string { return TableNameStaffUser }

// IsActive reports whether this login may still be used.
func (s *StaffUser) IsActive() bool { return s.Status == EntityStatusActive }
