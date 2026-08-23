package types

import "time"

// PaymentView is a payment attempt as the API returns it (DECISIONS.md D2).
type PaymentView struct {
	UID      string `json:"uid"`
	Provider string `json:"provider"`
	Method   string `json:"method"`
	Amount   Money  `json:"amount"`
	Status   string `json:"status"`
	// Reference is shown to the diner and to staff. It is what a staff member matches
	// against a bank notification when reconciling a static-UPI payment by eye.
	Reference string `json:"reference"`
	// UPIIntentURL is the upi://pay?... deep link. Present for static UPI, where the
	// diner's phone opens their UPI app directly.
	UPIIntentURL string `json:"upi_intent_url,omitempty"`
	// QRPNGBase64 is the same intent rendered as a scannable QR, for the case that
	// matters: the diner is paying from a second device, or the deep link did not fire.
	QRPNGBase64 string `json:"qr_png_base64,omitempty"`
	// ProviderOrderID and Key are what a gateway checkout widget needs to open.
	ProviderOrderID string `json:"provider_order_id,omitempty"`
	ProviderKeyID   string `json:"provider_key_id,omitempty"`
	// RequiresManualConfirmation is true for static UPI, which cannot detect that money
	// arrived. The diner app uses it to show "awaiting confirmation from staff" rather
	// than a spinner that will never resolve (DECISIONS.md D2).
	RequiresManualConfirmation bool       `json:"requires_manual_confirmation"`
	PaidAt                     *time.Time `json:"paid_at,omitempty"`
	CreatedAt                  time.Time  `json:"created_at"`
}

// RequestCreatePayment starts a payment for an already-placed order. Used when a diner
// picked "pay at counter" and then changed their mind, or when a first attempt failed.
type RequestCreatePayment struct {
	Method string `json:"method" binding:"required,oneof=online_upi counter"`
}

// RequestConfirmPayment is the staff action that settles a payment no gateway can confirm
// -- cash at the counter, or a static-UPI transfer staff saw land.
//
// This is a trust-the-staff flow, exactly like cash is today. The reference and the actor
// are both recorded so the action is attributable afterwards.
type RequestConfirmPayment struct {
	// Reference optionally records the bank UTR the staff member matched against.
	Reference string `json:"reference,omitempty" binding:"omitempty,max=64"`
	Note      string `json:"note,omitempty" binding:"omitempty,max=200"`
}

// RequestMarkPaymentFailed records an abandoned or failed attempt.
type RequestMarkPaymentFailed struct {
	Reason string `json:"reason,omitempty" binding:"omitempty,max=200"`
}

// ResponsePaymentStatus is what the diner app polls while awaiting confirmation.
type ResponsePaymentStatus struct {
	Payment PaymentView `json:"payment"`
	// OrderStatus is included so one poll answers both "did my payment land" and "has the
	// kitchen started", halving the request count on the screen a diner stares at.
	OrderStatus   string `json:"order_status"`
	PaymentStatus string `json:"payment_status"`
}
