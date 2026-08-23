// Package payments defines the payment seam and its implementations (DECISIONS.md D2).
//
// The interface exists so that shipping on static UPI -- which needs no gateway account,
// no KYC, and no integration -- does not paint the product into a corner where
// reconciliation is impossible forever. Adding a real gateway later is one file and one
// config value, not a refactor of the order flow.
package payments

import (
	"context"
	"errors"
	"fmt"
)

// Sentinel errors the order service maps onto ApplicationErrors. Providers return these
// rather than HTTP-shaped errors, because a provider knows nothing about HTTP.
var (
	// ErrNotConfigured means the provider exists but this restaurant has not finished
	// setting it up -- an empty VPA, absent gateway credentials.
	ErrNotConfigured = errors.New("payments: provider is not configured")
	// ErrUnsupported means the provider cannot do what was asked, e.g. verifying a webhook
	// it never sends.
	ErrUnsupported = errors.New("payments: operation not supported by this provider")
	// ErrSignatureInvalid means a webhook failed authentication and must be discarded.
	ErrSignatureInvalid = errors.New("payments: webhook signature verification failed")
	// ErrProviderUnavailable means the upstream gateway could not be reached. Distinct
	// from a rejection: retrying may work.
	ErrProviderUnavailable = errors.New("payments: provider unavailable")
)

// Capabilities describes what a provider can actually do, so the order service can branch
// on behaviour instead of on the provider's name.
//
// Naming providers in business logic is how a codebase ends up with `if provider ==
// "upi_static" || provider == "counter"` scattered across six files that all have to be
// found and edited when a seventh provider arrives.
type Capabilities struct {
	// AutoConfirms is true when the provider tells us, unprompted, that money arrived.
	// False for static UPI, where a bank transfer is invisible to us and a staff member
	// has to confirm it (DECISIONS.md D2).
	AutoConfirms bool
	// SendsWebhooks is true when the provider posts asynchronous events to us.
	SendsWebhooks bool
	// ProducesIntentURL is true when the provider yields a upi:// deep link the diner's
	// phone can open directly.
	ProducesIntentURL bool
	// ProducesQR is true when the intent can be rendered as a scannable QR code.
	ProducesQR bool
	// SupportsRefund is true when a refund can be issued through the provider.
	SupportsRefund bool
}

// IntentInput is everything a provider needs to start a payment.
type IntentInput struct {
	// OrderUID and OrderNumber identify the order to the diner and to staff.
	OrderUID    string
	OrderNumber string
	// AmountMinor is paise. Integer throughout (DECISIONS.md D7).
	AmountMinor int64
	Currency    string
	// Reference is our short, human-matchable payment reference. It goes into the UPI
	// transaction note, which is the entire reconciliation mechanism for static UPI.
	Reference string
	// PayeeVPA and PayeeName come from the restaurant, for static UPI.
	PayeeVPA  string
	PayeeName string
	// Note is the transaction description shown in the diner's UPI app.
	Note string
	// RestaurantName is used where a provider wants a merchant label.
	RestaurantName string
}

// Intent is a started payment, ready to hand to the diner.
type Intent struct {
	// IntentURL is the upi://pay?... deep link, when the provider produces one.
	IntentURL string
	// ProviderOrderID is the gateway's own order handle, when there is one.
	ProviderOrderID string
	// ProviderKeyID is the public key a gateway checkout widget needs.
	ProviderKeyID string
	// RequiresManualConfirmation mirrors the inverse of Capabilities.AutoConfirms, carried
	// on the intent so the diner app can be told plainly that a human will confirm --
	// rather than spinning forever on a payment nobody is watching for.
	RequiresManualConfirmation bool
	// Raw is the provider response, stored for dispute resolution.
	Raw map[string]any
}

// WebhookEvent is a verified provider callback, normalised across providers.
type WebhookEvent struct {
	// EventID is the provider's own event identifier. It is the idempotency key: the same
	// EventID must never be applied twice (DECISIONS.md D2).
	EventID string
	// EventType is the provider's event name, kept for the audit trail.
	EventType string
	// Reference ties the event back to our payment row.
	Reference string
	// ProviderPaymentID is the gateway's payment handle.
	ProviderPaymentID string
	// ProviderOrderID is the gateway's order handle.
	ProviderOrderID string
	// AmountMinor is what the provider says was paid. The service compares it against the
	// order total and refuses to settle a mismatch -- an underpayment silently marked paid
	// is money the restaurant loses without ever finding out.
	AmountMinor int64
	Currency    string
	// Paid and Failed are mutually exclusive. Neither set means an event we recognise but
	// which does not change payment state, and which should be recorded and ignored.
	Paid   bool
	Failed bool
	// FailureReason carries the provider's explanation, when it failed.
	FailureReason string
	// Raw is the full verified payload.
	Raw map[string]any
}

// Provider is the payment seam. Every implementation is safe for concurrent use.
type Provider interface {
	// Name is the stable identifier stored on payment rows.
	Name() string
	// Capabilities describes what this provider can do.
	Capabilities() Capabilities
	// CreateIntent starts a payment.
	CreateIntent(ctx context.Context, in IntentInput) (*Intent, error)
	// VerifyWebhook authenticates and parses a callback. Implementations that send no
	// webhooks return ErrUnsupported.
	//
	// Verification and parsing are deliberately one call: separating them invites a caller
	// to parse first and verify later, or forget the second step entirely, which turns the
	// webhook endpoint into an unauthenticated "mark this order paid" API.
	VerifyWebhook(ctx context.Context, raw []byte, headers map[string]string) (*WebhookEvent, error)
}

// Registry resolves a provider by name.
//
// Immutable after construction so it needs no lock: it is built once at startup and read
// on every request thereafter.
type Registry struct {
	providers map[string]Provider
	fallback  Provider
}

// NewRegistry builds a registry. The fallback is used when a restaurant names a provider
// that is not registered -- typically because its credentials are absent in this
// environment.
func NewRegistry(fallback Provider, providers ...Provider) *Registry {
	m := make(map[string]Provider, len(providers)+1)
	for _, p := range providers {
		if p != nil {
			m[p.Name()] = p
		}
	}
	if fallback != nil {
		m[fallback.Name()] = fallback
	}
	return &Registry{providers: m, fallback: fallback}
}

// Get returns the named provider, or the fallback.
//
// Falling back rather than erroring is deliberate: a restaurant configured for Razorpay in
// an environment with no Razorpay credentials should still be able to take orders on
// static UPI, not have its payment screen fail. The substitution is visible because the
// payment row records the provider that actually ran.
func (r *Registry) Get(name string) (Provider, error) {
	if p, ok := r.providers[name]; ok {
		return p, nil
	}
	if r.fallback != nil {
		return r.fallback, nil
	}
	return nil, fmt.Errorf("payments: no provider named %q and no fallback configured", name)
}

// Has reports whether a provider is registered under this name.
func (r *Registry) Has(name string) bool {
	_, ok := r.providers[name]
	return ok
}

// Names lists the registered providers, for the health endpoint.
func (r *Registry) Names() []string {
	out := make([]string, 0, len(r.providers))
	for name := range r.providers {
		out = append(out, name)
	}
	return out
}
