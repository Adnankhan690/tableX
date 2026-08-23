package payments

import (
	"context"
	"encoding/json"
	"fmt"
)

// Mock is a deterministic provider for tests and local development.
//
// Deterministic rather than random: a test that passes nine times in ten is worse than no
// test. Behaviour is set by the caller, and the default is a provider that auto-confirms,
// so the happy path is one line of setup.
type Mock struct {
	// FailIntent makes CreateIntent return ErrProviderUnavailable, for exercising the
	// gateway-down branch.
	FailIntent bool
	// AutoConfirm controls the reported capability.
	AutoConfirm bool
	// RejectSignature makes VerifyWebhook return ErrSignatureInvalid.
	RejectSignature bool
}

// NewMock builds a mock provider that auto-confirms and succeeds.
func NewMock() *Mock { return &Mock{AutoConfirm: true} }

// Name implements Provider.
func (m *Mock) Name() string { return "mock" }

// Capabilities implements Provider.
func (m *Mock) Capabilities() Capabilities {
	return Capabilities{
		AutoConfirms:      m.AutoConfirm,
		SendsWebhooks:     true,
		ProducesIntentURL: true,
		ProducesQR:        true,
		SupportsRefund:    true,
	}
}

// CreateIntent implements Provider.
func (m *Mock) CreateIntent(_ context.Context, in IntentInput) (*Intent, error) {
	if m.FailIntent {
		return nil, ErrProviderUnavailable
	}
	if in.AmountMinor <= 0 {
		return nil, fmt.Errorf("payments: mock: amount must be positive, got %d", in.AmountMinor)
	}
	return &Intent{
		// Derived from the reference so a test can predict it exactly.
		IntentURL:                  "upi://pay?pa=mock@tablex&am=" + formatAmountForUPI(in.AmountMinor) + "&tr=" + in.Reference,
		ProviderOrderID:            "mock_order_" + in.Reference,
		ProviderKeyID:              "mock_key",
		RequiresManualConfirmation: !m.AutoConfirm,
		Raw:                        map[string]any{"provider": "mock", "reference": in.Reference},
	}, nil
}

// VerifyWebhook implements Provider. The payload is the WebhookEvent itself as JSON, which
// keeps test fixtures readable.
func (m *Mock) VerifyWebhook(_ context.Context, raw []byte, _ map[string]string) (*WebhookEvent, error) {
	if m.RejectSignature {
		return nil, ErrSignatureInvalid
	}

	var body struct {
		EventID           string `json:"event_id"`
		EventType         string `json:"event_type"`
		Reference         string `json:"reference"`
		ProviderPaymentID string `json:"provider_payment_id"`
		AmountMinor       int64  `json:"amount_minor"`
		Paid              bool   `json:"paid"`
		Failed            bool   `json:"failed"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("payments: mock: %w", err)
	}
	if body.EventID == "" {
		return nil, fmt.Errorf("payments: mock: event_id is required")
	}

	return &WebhookEvent{
		EventID:           body.EventID,
		EventType:         body.EventType,
		Reference:         body.Reference,
		ProviderPaymentID: body.ProviderPaymentID,
		AmountMinor:       body.AmountMinor,
		Currency:          "INR",
		Paid:              body.Paid,
		Failed:            body.Failed,
		Raw:               map[string]any{"mock": true, "event_id": body.EventID},
	}, nil
}
