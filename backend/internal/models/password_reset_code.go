package models

import "time"

// PasswordResetCode holds a temporary code sent to a user's email to verify their identity.
type PasswordResetCode struct {
	ID        int32     `gorm:"primaryKey;autoIncrement" json:"id"`
	Email     string    `gorm:"size:255;not null;index" json:"email"`
	Code      string    `gorm:"size:6;not null" json:"code"`
	ExpiresAt time.Time `gorm:"not null" json:"expires_at"`
	Used      bool      `gorm:"not null;default:false" json:"used"`
	CreatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
}

func (PasswordResetCode) TableName() string { return TableNamePasswordResetCode }
