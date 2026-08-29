package models

import "time"

// DemoRequest is a restaurant owner asking to be shown the product.
//
// The one entity in this package with no RestaurantID, and the absence is the point: the row
// exists because the restaurant does not yet. Nothing joins it to anything -- onboarding is a
// conversation that ends in a platform call (DECISIONS.md D14), and a foreign key here would
// imply an automatic path from lead to tenant that nobody has built.
type DemoRequest struct {
	ID  int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID string `gorm:"size:64;not null;uniqueIndex" json:"uid"`

	Name           string `gorm:"size:128;not null" json:"name"`
	RestaurantName string `gorm:"size:160;not null" json:"restaurant_name"`

	// Phone is ten digits with no country code, normalised before it is written. The UNIQUE
	// index is what enforces one demo per number, and it only means that because every write
	// goes through the same normalisation (see services.normaliseDemoPhone).
	Phone string `gorm:"size:10;not null;uniqueIndex" json:"phone"`
	Email string `gorm:"size:255;not null;default:''" json:"email"`

	CreatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updated_at"`
}

func (DemoRequest) TableName() string { return TableNameDemoRequest }
