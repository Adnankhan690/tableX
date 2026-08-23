package models

import "time"

// Restaurant is the tenant root. Every tenant-owned row carries RestaurantID
// (DECISIONS.md D3).
type Restaurant struct {
	ID          int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID         string `gorm:"size:64;not null;unique" json:"uid"`
	Name        string `gorm:"size:128;not null" json:"name"`
	Slug        string `gorm:"size:64;not null;unique" json:"slug"`
	Description string `gorm:"type:text" json:"description,omitempty"`
	LogoURL     string `gorm:"type:text" json:"logo_url,omitempty"`
	Address     string `gorm:"type:text" json:"address,omitempty"`
	Phone       string `gorm:"size:20" json:"phone,omitempty"`
	Currency    string `gorm:"size:8;not null;default:'INR'" json:"currency"`
	Timezone    string `gorm:"size:64;not null;default:'Asia/Kolkata'" json:"timezone"`
	GSTNumber   string `gorm:"column:gst_number;size:20" json:"gst_number,omitempty"`

	// Basis points, not a percentage float: 500 = 5.00%. Keeps every money computation in
	// integer arithmetic (DECISIONS.md D7).
	TaxBps           int `gorm:"column:tax_bps;not null;default:500" json:"tax_bps"`
	ServiceChargeBps int `gorm:"column:service_charge_bps;not null;default:0" json:"service_charge_bps"`

	// Static-UPI payee details. Empty when the restaurant uses a gateway instead.
	UPIVPA          string              `gorm:"column:upi_vpa;size:128" json:"upi_vpa,omitempty"`
	UPIPayeeName    string              `gorm:"column:upi_payee_name;size:128" json:"upi_payee_name,omitempty"`
	PaymentProvider PaymentProviderName `gorm:"size:32;not null;default:'upi_static'" json:"payment_provider"`

	Status    EntityStatus `gorm:"size:32;not null;default:'active'" json:"status"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
}

func (Restaurant) TableName() string { return TableNameRestaurant }

// Location resolves the restaurant's timezone, falling back to IST.
//
// A broken or unset timezone string must not stop the restaurant taking orders, and the
// only thing it affects is which business date an order is counted against, so degrading
// to the market default is the right failure mode.
func (r *Restaurant) Location() *time.Location {
	if r.Timezone == "" {
		return istFallback()
	}
	loc, err := time.LoadLocation(r.Timezone)
	if err != nil {
		return istFallback()
	}
	return loc
}

// BusinessDate returns the service date t falls in, in the restaurant's own timezone.
// Used to scope the daily order-number counter (DECISIONS.md D9).
func (r *Restaurant) BusinessDate(t time.Time) time.Time {
	local := t.In(r.Location())
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
}

// istFallback returns Asia/Kolkata, or a fixed +05:30 zone if the system has no tzdata
// (a scratch container, typically).
func istFallback() *time.Location {
	if loc, err := time.LoadLocation("Asia/Kolkata"); err == nil {
		return loc
	}
	return time.FixedZone("IST", 5*3600+30*60)
}
