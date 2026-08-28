// Package models holds the GORM entities. Each struct mirrors exactly one migration in
// backend/migrations/postgres -- when one changes, the other changes in the same commit.
package models

// Table names live as constants because a typo'd string literal in a Where clause fails
// at runtime against a real database, and only for the query that happens to be hit.
const (
	TableNameRestaurant          = "restaurant"
	TableNameStaffUser           = "staff_user"
	TableNameRestaurantTable     = "restaurant_table"
	TableNameMenuCategory        = "menu_category"
	TableNameMenuItem            = "menu_item"
	TableNameGuestSession        = "guest_session"
	TableNameOrder               = "orders"
	TableNameOrderItem           = "order_item"
	TableNameOrderStatusEvent    = "order_status_event"
	TableNamePayment             = "payment"
	TableNamePaymentWebhookEvent = "payment_webhook_event"
	TableNameOrderCounter        = "order_counter"
	TableNamePasswordResetCode   = "password_reset_code"
)

// EntityStatus is the shared lifecycle flag on long-lived rows.
//
// Distinct from MenuItem.IsAvailable: status is "does this exist on the menu at all",
// availability is "did we run out tonight". Archiving a sold-out dish would break its
// order history.
type EntityStatus string

const (
	EntityStatusActive   EntityStatus = "active"
	EntityStatusInactive EntityStatus = "inactive"
	EntityStatusArchived EntityStatus = "archived"
)

// StaffRole gates admin-panel capability. Roles are ordered: owner ⊃ manager ⊃ staff.
type StaffRole string

const (
	StaffRoleOwner   StaffRole = "owner"
	StaffRoleManager StaffRole = "manager"
	StaffRoleStaff   StaffRole = "staff"
)

// CanManageMenu reports whether the role may edit the menu, tables, or other staff.
// Floor staff move orders through the kitchen; they do not reprice the menu mid-service.
func (r StaffRole) CanManageMenu() bool {
	return r == StaffRoleOwner || r == StaffRoleManager
}

// CanManageStaff reports whether the role may create or remove staff logins.
func (r StaffRole) CanManageStaff() bool { return r == StaffRoleOwner }

// Valid reports whether the role is one this application recognises.
func (r StaffRole) Valid() bool {
	switch r {
	case StaffRoleOwner, StaffRoleManager, StaffRoleStaff:
		return true
	}
	return false
}

// FoodType is the veg/non-veg marker. Required on every item: in this market an
// unlabelled dish is simply not orderable for a large share of diners (PRD 6.2).
type FoodType string

const (
	FoodTypeVeg    FoodType = "veg"
	FoodTypeNonVeg FoodType = "non_veg"
	FoodTypeEgg    FoodType = "egg"
)

// Valid reports whether the food type is recognised. Mirrors the CHECK constraint on
// menu_item.food_type.
func (f FoodType) Valid() bool {
	switch f {
	case FoodTypeVeg, FoodTypeNonVeg, FoodTypeEgg:
		return true
	}
	return false
}

// SpiceLevel is optional -- it is meaningless for a soft drink.
type SpiceLevel string

const (
	SpiceLevelMild   SpiceLevel = "mild"
	SpiceLevelMedium SpiceLevel = "medium"
	SpiceLevelHot    SpiceLevel = "hot"
)

// Valid reports whether the spice level is recognised. The empty string is valid and
// means "not applicable".
func (s SpiceLevel) Valid() bool {
	switch s {
	case "", SpiceLevelMild, SpiceLevelMedium, SpiceLevelHot:
		return true
	}
	return false
}

// OrderStatus is the kitchen-facing lifecycle (DECISIONS.md D1). Legal transitions are
// defined once, in services.OrderStateMachine -- this type only names the states.
type OrderStatus string

const (
	OrderStatusPlaced    OrderStatus = "placed"
	OrderStatusAccepted  OrderStatus = "accepted"
	OrderStatusPreparing OrderStatus = "preparing"
	OrderStatusReady     OrderStatus = "ready"
	OrderStatusServed    OrderStatus = "served"
	OrderStatusCompleted OrderStatus = "completed"
	OrderStatusRejected  OrderStatus = "rejected"
	OrderStatusCancelled OrderStatus = "cancelled"
)

// Valid mirrors the CHECK constraint on orders.status.
func (s OrderStatus) Valid() bool {
	switch s {
	case OrderStatusPlaced, OrderStatusAccepted, OrderStatusPreparing, OrderStatusReady,
		OrderStatusServed, OrderStatusCompleted, OrderStatusRejected, OrderStatusCancelled:
		return true
	}
	return false
}

// IsTerminal reports whether the order can never change status again.
func (s OrderStatus) IsTerminal() bool {
	switch s {
	case OrderStatusCompleted, OrderStatusRejected, OrderStatusCancelled:
		return true
	}
	return false
}

// IsLive reports whether the order still needs attention on the kitchen board.
func (s OrderStatus) IsLive() bool { return !s.IsTerminal() }

// PaymentMethod is what the diner chose on the payment screen (PRD 6.4).
type PaymentMethod string

const (
	PaymentMethodOnlineUPI PaymentMethod = "online_upi"
	PaymentMethodCounter   PaymentMethod = "counter"
)

// Valid mirrors the CHECK constraint on orders.payment_method.
func (m PaymentMethod) Valid() bool {
	switch m {
	case PaymentMethodOnlineUPI, PaymentMethodCounter:
		return true
	}
	return false
}

// PaymentStatus tracks money, deliberately separate from OrderStatus which tracks food.
// A counter order is served long before it is paid; an online order is paid before it is
// accepted. One column could not represent both.
type PaymentStatus string

const (
	PaymentStatusPending  PaymentStatus = "pending"
	PaymentStatusPaid     PaymentStatus = "paid"
	PaymentStatusFailed   PaymentStatus = "failed"
	PaymentStatusRefunded PaymentStatus = "refunded"
)

// Valid mirrors the CHECK constraint on orders.payment_status.
func (s PaymentStatus) Valid() bool {
	switch s {
	case PaymentStatusPending, PaymentStatusPaid, PaymentStatusFailed, PaymentStatusRefunded:
		return true
	}
	return false
}

// PaymentProviderName identifies which implementation of payments.Provider settles an
// order (DECISIONS.md D2).
type PaymentProviderName string

const (
	// PaymentProviderUPIStatic builds a upi:// intent from the restaurant's own VPA. No
	// gateway, no fees, and no automatic confirmation -- staff marks it paid.
	PaymentProviderUPIStatic PaymentProviderName = "upi_static"
	// PaymentProviderRazorpay does real order creation and HMAC-verified webhooks.
	PaymentProviderRazorpay PaymentProviderName = "razorpay"
	// PaymentProviderMock is deterministic, for tests and local development.
	PaymentProviderMock PaymentProviderName = "mock"
	// PaymentProviderCounter records cash or card taken at the counter.
	PaymentProviderCounter PaymentProviderName = "counter"
)

// OrderItemStatus allows cancelling one line without deleting the row, so the kitchen
// ticket history stays intact (PRD 9.1).
type OrderItemStatus string

const (
	OrderItemStatusActive    OrderItemStatus = "active"
	OrderItemStatusCancelled OrderItemStatus = "cancelled"
)

// ActorType records who caused a status transition, for the audit log.
type ActorType string

const (
	ActorTypeGuest ActorType = "guest"
	ActorTypeStaff ActorType = "staff"
	// ActorTypeSystem covers transitions with no human behind them, such as a payment
	// webhook auto-completing an order.
	ActorTypeSystem ActorType = "system"
)
