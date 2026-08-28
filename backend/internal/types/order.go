package types

import "time"

// RequestPlaceOrder is the diner's checkout body.
//
// Note what it does not contain: any amount. The client sends items and quantities, and
// the server prices the order from the current menu. A client-supplied total would let a
// diner order a thali for one rupee (DECISIONS.md D7).
type RequestPlaceOrder struct {
	Items []RequestOrderItem `json:"items" binding:"required,min=1,max=50,dive"`
	// PaymentMethod is chosen on the payment screen (PRD 6.4).
	PaymentMethod string `json:"payment_method" binding:"required,oneof=online_upi counter"`
	CustomerName  string `json:"customer_name,omitempty" binding:"omitempty,max=128"`
	// CustomerPhone is optional and exists so the restaurant can call the diner back. It
	// is not an identity: there is no login in this product (DECISIONS.md D5).
	CustomerPhone string `json:"customer_phone,omitempty" binding:"omitempty,max=20"`
	Note          string `json:"note,omitempty" binding:"omitempty,max=500"`
}

// RequestOrderItem is one cart line.
type RequestOrderItem struct {
	MenuItemUID string `json:"menu_item_uid" binding:"required"`
	Quantity    int    `json:"quantity" binding:"required,min=1,max=99"`
	Note        string `json:"note,omitempty" binding:"omitempty,max=200"`
}

// OrderItemView is one line as the API returns it, with its snapshotted values
// (DECISIONS.md D8).
type OrderItemView struct {
	UID       string `json:"uid"`
	Name      string `json:"name"`
	UnitPrice Money  `json:"unit_price"`
	Quantity  int    `json:"quantity"`
	Total     Money  `json:"total"`
	FoodType  string `json:"food_type"`
	Note      string `json:"note,omitempty"`
	Status    string `json:"status"`
	// Review is this diner's own rating of this line, when they have left one, so the
	// tracking screen renders the stars already given instead of an empty row to re-fill
	// after every refresh.
	Review *OrderItemReviewView `json:"review,omitempty"`
}

// OrderTotals is the price breakdown the cart and the bill both render.
type OrderTotals struct {
	Subtotal      Money `json:"subtotal"`
	Tax           Money `json:"tax"`
	ServiceCharge Money `json:"service_charge"`
	Discount      Money `json:"discount"`
	Total         Money `json:"total"`
}

// OrderStatusEventView is one entry in the diner's progress timeline.
type OrderStatusEventView struct {
	Status    string    `json:"status"`
	ActorType string    `json:"actor_type"`
	Note      string    `json:"note,omitempty"`
	At        time.Time `json:"at"`
}

// OrderView is the full order, used by both the diner tracking screen and the admin panel.
type OrderView struct {
	UID         string `json:"uid"`
	OrderNumber string `json:"order_number"`
	Status      string `json:"status"`
	// TableLabel rather than a table object: the admin queue needs "Table 12" and nothing
	// more, and the diner already knows where they are sitting.
	TableLabel    string          `json:"table_label"`
	Items         []OrderItemView `json:"items"`
	Totals        OrderTotals     `json:"totals"`
	PaymentMethod string          `json:"payment_method"`
	PaymentStatus string          `json:"payment_status"`
	CustomerName  string          `json:"customer_name,omitempty"`
	CustomerPhone string          `json:"customer_phone,omitempty"`
	Note          string          `json:"note,omitempty"`
	CancelReason  string          `json:"cancel_reason,omitempty"`

	PlacedAt    time.Time  `json:"placed_at"`
	AcceptedAt  *time.Time `json:"accepted_at,omitempty"`
	PreparingAt *time.Time `json:"preparing_at,omitempty"`
	ReadyAt     *time.Time `json:"ready_at,omitempty"`
	ServedAt    *time.Time `json:"served_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CancelledAt *time.Time `json:"cancelled_at,omitempty"`

	Timeline []OrderStatusEventView `json:"timeline,omitempty"`

	// NextStatuses is the set of transitions legal from here, computed server-side.
	//
	// Sent so the admin panel renders exactly the buttons that will work, instead of
	// reimplementing the state machine in TypeScript and drifting from it (DECISIONS.md D1).
	NextStatuses []string `json:"next_statuses,omitempty"`
	// CanGuestCancel encodes the guest cancel window the same way (DECISIONS.md D6).
	CanGuestCancel bool `json:"can_guest_cancel"`

	// CanReview is the rating window, computed server-side for the same reason as the two
	// flags above: the client renders the card exactly when submitting will work, rather
	// than reimplementing the eligibility rules and drifting from them.
	//
	// Deliberately NOT a status comparison the client could make itself. The window opens on
	// whichever of several signals fires first -- staff marking the order served, a counter
	// payment settling, or a timeout after the kitchen stopped tapping -- because tying it to
	// `status == served` alone would silently exclude every diner whose restaurant forgets
	// that last tap. services.ReviewEligibilityFor is the single authority.
	CanReview bool `json:"can_review"`
	// ReviewOpensAt is when the window will open, sent only while it is still shut. The diner
	// app sets one timer for that instant instead of waiting to notice on its next poll.
	ReviewOpensAt *time.Time `json:"review_opens_at,omitempty"`
	// ReviewClosesAt is when it shuts, so a late arrival can be told "too late" rather than
	// being shown a card that will fail.
	ReviewClosesAt *time.Time `json:"review_closes_at,omitempty"`

	// ServiceReview is this SESSION's service rating, when it has left one -- not this order's.
	// Service is rated once per sitting (DECISIONS.md D17), so a diner with two open orders sees
	// the same answer pre-filled on both, and editing either updates the one row.
	//
	// Gated by the same CanReview window: there is no separate can_review_service flag, because
	// the two would only ever disagree by accident.
	ServiceReview *ServiceReviewView `json:"service_review,omitempty"`
}

// ResponsePlaceOrder is returned once the order is committed.
type ResponsePlaceOrder struct {
	Order OrderView `json:"order"`
	// Payment is present when the diner chose online_upi, carrying the UPI intent to open.
	Payment *PaymentView `json:"payment,omitempty"`
}

// ResponseOrderList is a page of orders.
type ResponseOrderList struct {
	Orders []OrderView `json:"orders"`
	Meta   PageMeta    `json:"meta"`
}

// RequestListOrders filters the admin order queue (PRD 6.6).
type RequestListOrders struct {
	Pagination
	// Status accepts repeated values, so the live board can ask for the four open states
	// in one query.
	Status []string `form:"status"`
	// TableUID filters to one table.
	TableUID string `form:"table_uid"`
	// PaymentStatus filters to unpaid orders, which is how staff find who still owes.
	PaymentStatus string `form:"payment_status"`
	// Live is a shorthand for "everything not in a terminal state" -- the kitchen board's
	// only query.
	Live bool `form:"live"`
	// Search matches an order number or a customer name.
	Search string `form:"search"`
	From   string `form:"from"`
	To     string `form:"to"`
}

// RequestTransitionOrder moves an order to a new status (DECISIONS.md D1).
type RequestTransitionOrder struct {
	Status string `json:"status" binding:"required,oneof=accepted preparing ready served completed rejected cancelled"`
	// Reason is required for rejected and cancelled, enforced in the service rather than
	// by a binding tag, because the requirement depends on the target status.
	Reason string `json:"reason,omitempty" binding:"omitempty,max=500"`
}

// RequestCancelOrderItem cancels one line without voiding the order (PRD 9.1).
type RequestCancelOrderItem struct {
	Reason string `json:"reason,omitempty" binding:"omitempty,max=200"`
}

// ResponseGuestOrders lists the orders placed from this guest session -- "your orders at
// this table this sitting" (DECISIONS.md D5).
type ResponseGuestOrders struct {
	Orders []OrderView `json:"orders"`
}

// OrderStatsView is the admin dashboard summary, keyed to the PRD's throughput metric
// (PRD 3).
type OrderStatsView struct {
	// BusinessDate is the service date these figures cover, in the restaurant's timezone.
	BusinessDate    string `json:"business_date"`
	OrdersPlaced    int64  `json:"orders_placed"`
	OrdersCompleted int64  `json:"orders_completed"`
	OrdersCancelled int64  `json:"orders_cancelled"`
	OrdersLive      int64  `json:"orders_live"`
	Revenue         Money  `json:"revenue"`
	UnpaidAmount    Money  `json:"unpaid_amount"`
	// AvgAcceptSecs and AvgFulfilSecs are the PRD's order-taking-time and throughput
	// metrics, measured rather than estimated.
	AvgAcceptSecs *int64 `json:"avg_accept_secs,omitempty"`
	AvgFulfilSecs *int64 `json:"avg_fulfil_secs,omitempty"`
}
