package models

import "time"

// Order is the central entity. The table is "orders" because "order" is a reserved SQL
// word.
//
// Totals are stored, not recomputed on read: a later change to the restaurant's tax rate
// must not retroactively alter a bill that has already been shown to a diner and paid.
type Order struct {
	ID             int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID            string `gorm:"size:64;not null;unique" json:"uid"`
	RestaurantID   int32  `gorm:"not null;index" json:"restaurant_id"`
	TableID        int32  `gorm:"not null;index" json:"table_id"`
	GuestSessionID *int32 `json:"guest_session_id,omitempty"`
	// OrderNumber is the short daily counter shouted across a kitchen, "A-014"
	// (DECISIONS.md D9). UID remains the API identifier.
	OrderNumber string `gorm:"size:32;not null" json:"order_number"`
	// BusinessDate is the service date OrderNumber was allocated against, in the restaurant's
	// own timezone -- a 1am order belongs to the previous evening's service. Stored rather than
	// derived from PlacedAt because it is what scopes the uniqueness of OrderNumber: the counter
	// resets daily, so without the date in the index the first order of each day collides with
	// the previous day's. Uniqueness is (restaurant_id, business_date, order_number).
	BusinessDate time.Time   `gorm:"type:date;not null" json:"business_date"`
	Status       OrderStatus `gorm:"size:32;not null;default:'placed'" json:"status"`

	// All amounts are paise (DECISIONS.md D7).
	SubtotalMinor      int64  `gorm:"not null" json:"subtotal_minor"`
	TaxMinor           int64  `gorm:"not null;default:0" json:"tax_minor"`
	ServiceChargeMinor int64  `gorm:"not null;default:0" json:"service_charge_minor"`
	DiscountMinor      int64  `gorm:"not null;default:0" json:"discount_minor"`
	TotalMinor         int64  `gorm:"not null" json:"total_minor"`
	Currency           string `gorm:"size:8;not null;default:'INR'" json:"currency"`

	PaymentMethod PaymentMethod `gorm:"size:32;not null" json:"payment_method"`
	PaymentStatus PaymentStatus `gorm:"size:32;not null;default:'pending'" json:"payment_status"`

	CustomerName  string `gorm:"size:128" json:"customer_name,omitempty"`
	CustomerPhone string `gorm:"size:20" json:"customer_phone,omitempty"`
	Note          string `gorm:"type:text" json:"note,omitempty"`

	// IdempotencyKey deduplicates the double-tap on a stalled phone (DECISIONS.md D12).
	IdempotencyKey *string `gorm:"size:128" json:"-"`

	PlacedAt     time.Time  `gorm:"not null" json:"placed_at"`
	AcceptedAt   *time.Time `json:"accepted_at,omitempty"`
	PreparingAt  *time.Time `json:"preparing_at,omitempty"`
	ReadyAt      *time.Time `json:"ready_at,omitempty"`
	ServedAt     *time.Time `json:"served_at,omitempty"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
	CancelledAt  *time.Time `json:"cancelled_at,omitempty"`
	CancelReason string     `gorm:"type:text" json:"cancel_reason,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	Items      []OrderItem        `gorm:"foreignKey:OrderID" json:"items,omitempty"`
	Events     []OrderStatusEvent `gorm:"foreignKey:OrderID" json:"events,omitempty"`
	Table      *RestaurantTable   `gorm:"foreignKey:TableID" json:"table,omitempty"`
	Restaurant *Restaurant        `gorm:"foreignKey:RestaurantID" json:"restaurant,omitempty"`
	Payments   []Payment          `gorm:"foreignKey:OrderID" json:"payments,omitempty"`
}

func (Order) TableName() string { return TableNameOrder }

// StatusTimestampField returns a pointer to the timestamp column that records entry into
// the given status, or nil for statuses with no dedicated column.
//
// Centralised here so a transition applier cannot set status without stamping the matching
// time, which is what keeps the diner's timeline and the status column from disagreeing.
func (o *Order) StatusTimestampField(s OrderStatus) **time.Time {
	switch s {
	case OrderStatusAccepted:
		return &o.AcceptedAt
	case OrderStatusPreparing:
		return &o.PreparingAt
	case OrderStatusReady:
		return &o.ReadyAt
	case OrderStatusServed:
		return &o.ServedAt
	case OrderStatusCompleted:
		return &o.CompletedAt
	case OrderStatusCancelled, OrderStatusRejected:
		return &o.CancelledAt
	}
	return nil
}

// ActiveItems returns the lines that still count toward the bill, excluding any the
// kitchen cancelled individually.
func (o *Order) ActiveItems() []OrderItem {
	out := make([]OrderItem, 0, len(o.Items))
	for _, it := range o.Items {
		if it.Status == OrderItemStatusActive {
			out = append(out, it)
		}
	}
	return out
}

// OrderItem is one line on an order. Name, price and food type are snapshotted at order
// time and never joined live from MenuItem (DECISIONS.md D8).
type OrderItem struct {
	ID      int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID     string `gorm:"size:64;not null;unique" json:"uid"`
	OrderID int32  `gorm:"not null;index" json:"order_id"`
	// MenuItemID is kept for analytics, never for display or pricing.
	MenuItemID int32 `gorm:"not null;index" json:"menu_item_id"`

	NameSnapshot   string   `gorm:"size:128;not null" json:"name"`
	UnitPriceMinor int64    `gorm:"not null" json:"unit_price_minor"`
	FoodType       FoodType `gorm:"size:16;not null" json:"food_type"`

	Quantity   int             `gorm:"not null" json:"quantity"`
	TotalMinor int64           `gorm:"not null" json:"total_minor"`
	Note       string          `gorm:"type:text" json:"note,omitempty"`
	Status     OrderItemStatus `gorm:"size:32;not null;default:'active'" json:"status"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`

	// Review is the diner's own rating of this line, when they have left one. Preloaded
	// with the order so the tracking screen can render the stars already given rather than
	// offering an empty row the diner has to re-fill after a refresh.
	Review *OrderItemReview `gorm:"foreignKey:OrderItemID" json:"review,omitempty"`
}

func (OrderItem) TableName() string { return TableNameOrderItem }

// OrderStatusEvent is one row in the append-only transition log. It renders the diner's
// timeline and answers "who cancelled table 7's order" after the fact.
type OrderStatusEvent struct {
	ID      int64 `gorm:"primaryKey;autoIncrement" json:"id"`
	OrderID int32 `gorm:"not null;index" json:"order_id"`
	// FromStatus is empty on the first event, where the order came into existence.
	FromStatus OrderStatus `gorm:"size:32" json:"from_status,omitempty"`
	ToStatus   OrderStatus `gorm:"size:32;not null" json:"to_status"`
	ActorType  ActorType   `gorm:"size:16;not null" json:"actor_type"`
	// ActorID holds a uid (stf_... or gst_...) as text, so one column serves both kinds.
	ActorID   string    `gorm:"size:64" json:"actor_id,omitempty"`
	Note      string    `gorm:"type:text" json:"note,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (OrderStatusEvent) TableName() string { return TableNameOrderStatusEvent }

// OrderCounter allocates the per-restaurant, per-day human order number. Incremented
// under a row lock inside the placement transaction (DECISIONS.md D9).
type OrderCounter struct {
	ID           int32 `gorm:"primaryKey;autoIncrement" json:"id"`
	RestaurantID int32 `gorm:"not null" json:"restaurant_id"`
	// BusinessDate is a date in the restaurant's own timezone, not UTC: a 1am order belongs
	// to the previous evening's service as far as the kitchen is concerned.
	BusinessDate time.Time `gorm:"type:date;not null" json:"business_date"`
	LastNumber   int       `gorm:"not null;default:0" json:"last_number"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (OrderCounter) TableName() string { return TableNameOrderCounter }
