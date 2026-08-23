package models

import "time"

// RestaurantTable is a physical table, with its own QR code (DECISIONS.md D4).
type RestaurantTable struct {
	ID           int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID          string `gorm:"size:64;not null;unique" json:"uid"`
	RestaurantID int32  `gorm:"not null;index" json:"restaurant_id"`
	// Label is what is printed on the QR card: "12", "T-4", "Patio 2".
	Label string `gorm:"size:32;not null" json:"label"`
	// QRToken is the opaque, rotatable token in the QR URL. Not serialised to diners --
	// possession of it is what authorises ordering at this table, so it is only ever
	// returned to authenticated staff via the QR-management endpoints.
	QRToken   string       `gorm:"column:qr_token;size:64;not null;unique" json:"-"`
	Seats     *int         `json:"seats,omitempty"`
	Status    EntityStatus `gorm:"size:32;not null;default:'active'" json:"status"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`

	Restaurant *Restaurant `gorm:"foreignKey:RestaurantID" json:"restaurant,omitempty"`
}

func (RestaurantTable) TableName() string { return TableNameRestaurantTable }
