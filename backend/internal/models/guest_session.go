package models

import "time"

// GuestSession is the anonymous diner identity created on first QR scan. There is no
// login (PRD 6.1); the token in the browser is the whole identity (DECISIONS.md D5).
type GuestSession struct {
	ID           int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID          string `gorm:"size:64;not null;unique" json:"uid"`
	RestaurantID int32  `gorm:"not null" json:"restaurant_id"`
	TableID      int32  `gorm:"not null;index" json:"table_id"`
	// Token is the bearer value held in the diner's localStorage. json:"-" because it is
	// returned exactly once, by the session-create endpoint, through an explicit DTO --
	// never incidentally as part of an embedded session object.
	Token     string    `gorm:"size:128;not null;unique" json:"-"`
	UserAgent string    `gorm:"type:text" json:"-"`
	ExpiresAt time.Time `gorm:"not null;index" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	Restaurant *Restaurant      `gorm:"foreignKey:RestaurantID" json:"restaurant,omitempty"`
	Table      *RestaurantTable `gorm:"foreignKey:TableID" json:"table,omitempty"`
}

func (GuestSession) TableName() string { return TableNameGuestSession }

// Expired reports whether the session may no longer be used. Takes now as a parameter so
// tests can exercise the boundary without sleeping.
func (g *GuestSession) Expired(now time.Time) bool { return !now.Before(g.ExpiresAt) }
