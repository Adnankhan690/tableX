package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

// JSONMap is a JSONB column. It round-trips through driver.Valuer/sql.Scanner so a
// provider payload can be stored verbatim without a bespoke type per provider.
type JSONMap map[string]any

// Value implements driver.Valuer. A nil map stores SQL NULL rather than the four bytes
// "null", so `IS NULL` behaves as expected in queries.
func (m JSONMap) Value() (driver.Value, error) {
	if m == nil {
		return nil, nil
	}
	return json.Marshal(m)
}

// Scan implements sql.Scanner for both []byte (Postgres) and string (SQLite) payloads.
func (m *JSONMap) Scan(src any) error {
	if src == nil {
		*m = nil
		return nil
	}
	var raw []byte
	switch v := src.(type) {
	case []byte:
		raw = v
	case string:
		raw = []byte(v)
	default:
		return fmt.Errorf("models: cannot scan %T into JSONMap", src)
	}
	if len(raw) == 0 {
		*m = nil
		return nil
	}
	return json.Unmarshal(raw, m)
}

// Payment is one payment attempt against an order (DECISIONS.md D2).
type Payment struct {
	ID           int32               `gorm:"primaryKey;autoIncrement" json:"id"`
	UID          string              `gorm:"size:64;not null;unique" json:"uid"`
	RestaurantID int32               `gorm:"not null;index" json:"restaurant_id"`
	OrderID      int32               `gorm:"not null;index" json:"order_id"`
	Provider     PaymentProviderName `gorm:"size:32;not null" json:"provider"`
	Method       PaymentMethod       `gorm:"size:32;not null" json:"method"`
	AmountMinor  int64               `gorm:"not null" json:"amount_minor"`
	Currency     string              `gorm:"size:8;not null;default:'INR'" json:"currency"`
	Status       PaymentStatus       `gorm:"size:32;not null;default:'pending'" json:"status"`

	// Gateway identifiers. Empty for upi_static and counter, which have no gateway.
	ProviderOrderID   string `gorm:"size:128" json:"provider_order_id,omitempty"`
	ProviderPaymentID string `gorm:"size:128" json:"provider_payment_id,omitempty"`

	// UPIIntentURL is the upi://pay?... deep link the diner's UPI app opens.
	UPIIntentURL string `gorm:"column:upi_intent_url;type:text" json:"upi_intent_url,omitempty"`
	// Reference is echoed in the UPI transaction note so staff can match a bank
	// notification to an order by eye -- the whole reconciliation story for upi_static.
	Reference string `gorm:"size:64;not null" json:"reference"`

	// RawPayload keeps the verified provider payload for dispute resolution.
	RawPayload JSONMap    `gorm:"type:jsonb" json:"-"`
	PaidAt     *time.Time `json:"paid_at,omitempty"`
	FailedAt   *time.Time `json:"failed_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (Payment) TableName() string { return TableNamePayment }

// PaymentWebhookEvent is the webhook idempotency ledger. Inserting a row is the guard:
// the unique (provider, event_id) index makes a duplicate delivery fail to insert, and the
// handler reads that failure as "already handled" rather than settling twice.
type PaymentWebhookEvent struct {
	ID       int64               `gorm:"primaryKey;autoIncrement" json:"id"`
	Provider PaymentProviderName `gorm:"size:32;not null" json:"provider"`
	// EventID is the provider's own event identifier.
	EventID   string `gorm:"size:128;not null" json:"event_id"`
	EventType string `gorm:"size:64" json:"event_type,omitempty"`
	// PaymentID is nullable: a webhook can name a payment we have never heard of, and that
	// is worth recording rather than dropping.
	PaymentID   *int32     `json:"payment_id,omitempty"`
	Payload     JSONMap    `gorm:"type:jsonb;not null" json:"-"`
	SignatureOK bool       `gorm:"column:signature_ok;not null;default:false" json:"signature_ok"`
	ProcessedAt *time.Time `json:"processed_at,omitempty"`
	Error       string     `gorm:"type:text" json:"error,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (PaymentWebhookEvent) TableName() string { return TableNamePaymentWebhookEvent }
