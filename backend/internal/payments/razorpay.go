package payments

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Razorpay is the gateway adapter for restaurants that need real reconciliation
// (DECISIONS.md D2).
//
// It is credentials-gated: with no key configured every call returns ErrNotConfigured and
// the registry falls back to static UPI, so an environment without Razorpay secrets still
// takes orders rather than failing its payment screen.
type Razorpay struct {
	keyID         string
	keySecret     string
	webhookSecret string
	baseURL       string
	http          *http.Client
}

// NewRazorpay builds the adapter. Absent credentials produce a provider that reports
// itself unconfigured rather than a nil one, so callers need no nil check.
func NewRazorpay(keyID, keySecret, webhookSecret, baseURL string) *Razorpay {
	if baseURL == "" {
		baseURL = "https://api.razorpay.com/v1"
	}
	return &Razorpay{
		keyID:         strings.TrimSpace(keyID),
		keySecret:     strings.TrimSpace(keySecret),
		webhookSecret: strings.TrimSpace(webhookSecret),
		baseURL:       strings.TrimRight(baseURL, "/"),
		// An explicit timeout, because the default http.Client has none: a hung gateway
		// would otherwise hold a diner's checkout request open indefinitely.
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

// Name implements Provider.
func (r *Razorpay) Name() string { return "razorpay" }

// Capabilities implements Provider.
func (r *Razorpay) Capabilities() Capabilities {
	return Capabilities{
		AutoConfirms:      true,
		SendsWebhooks:     true,
		ProducesIntentURL: false,
		ProducesQR:        false,
		SupportsRefund:    true,
	}
}

// Configured reports whether the credentials needed to create an order are present.
func (r *Razorpay) Configured() bool { return r.keyID != "" && r.keySecret != "" }

// CreateIntent creates a Razorpay order and returns the handles the checkout widget needs.
func (r *Razorpay) CreateIntent(ctx context.Context, in IntentInput) (*Intent, error) {
	if !r.Configured() {
		return nil, ErrNotConfigured
	}
	if in.AmountMinor <= 0 {
		return nil, fmt.Errorf("payments: razorpay: amount must be positive, got %d", in.AmountMinor)
	}

	currency := in.Currency
	if currency == "" {
		currency = "INR"
	}

	// Razorpay takes the amount in the smallest currency unit, which is exactly what we
	// already hold -- so no conversion, and no rounding (DECISIONS.md D7).
	body := map[string]any{
		"amount":   in.AmountMinor,
		"currency": currency,
		// receipt is the idempotency handle on Razorpay's side: replaying the same receipt
		// returns the same order rather than creating a second one.
		"receipt": in.Reference,
		"notes": map[string]string{
			"order_uid":    in.OrderUID,
			"order_number": in.OrderNumber,
			"restaurant":   in.RestaurantName,
		},
	}

	raw, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("payments: razorpay: encode request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL+"/orders", bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("payments: razorpay: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(r.keyID, r.keySecret)

	resp, err := r.http.Do(req)
	if err != nil {
		// A transport failure is reported as unavailable, not as a rejection, so the caller
		// can offer "try again or pay at the counter" rather than declaring the order bad.
		return nil, fmt.Errorf("%w: %v", ErrProviderUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// Bounded read: an upstream that streams an unbounded body must not be able to exhaust
	// this process's memory.
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: read response: %v", ErrProviderUnavailable, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("payments: razorpay: order creation returned %d: %s",
			resp.StatusCode, truncate(string(payload), 300))
	}

	var created struct {
		ID       string `json:"id"`
		Amount   int64  `json:"amount"`
		Currency string `json:"currency"`
		Status   string `json:"status"`
	}
	if err := json.Unmarshal(payload, &created); err != nil {
		return nil, fmt.Errorf("payments: razorpay: decode response: %w", err)
	}
	if created.ID == "" {
		return nil, fmt.Errorf("payments: razorpay: response contained no order id")
	}

	return &Intent{
		ProviderOrderID:            created.ID,
		ProviderKeyID:              r.keyID,
		RequiresManualConfirmation: false,
		Raw: map[string]any{
			"provider": "razorpay",
			"order_id": created.ID,
			"amount":   created.Amount,
			"status":   created.Status,
		},
	}, nil
}

// VerifyWebhook authenticates a Razorpay callback and normalises it.
//
// The HMAC check is the security boundary of this endpoint: without it, anyone who learns
// the URL can mark any order paid. It therefore runs before any parsing, and uses a
// constant-time comparison so the signature cannot be recovered a byte at a time by
// timing the response.
func (r *Razorpay) VerifyWebhook(_ context.Context, raw []byte, headers map[string]string) (*WebhookEvent, error) {
	if r.webhookSecret == "" {
		return nil, ErrNotConfigured
	}

	signature := headerLookup(headers, "X-Razorpay-Signature")
	if signature == "" {
		return nil, ErrSignatureInvalid
	}

	mac := hmac.New(sha256.New, []byte(r.webhookSecret))
	mac.Write(raw)
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(strings.TrimSpace(signature))) {
		return nil, ErrSignatureInvalid
	}

	var body struct {
		Event   string `json:"event"`
		Payload struct {
			Payment struct {
				Entity struct {
					ID          string         `json:"id"`
					OrderID     string         `json:"order_id"`
					Amount      int64          `json:"amount"`
					Currency    string         `json:"currency"`
					Status      string         `json:"status"`
					ErrorReason string         `json:"error_reason"`
					ErrorDesc   string         `json:"error_description"`
					Notes       map[string]any `json:"notes"`
					Receipt     string         `json:"receipt"`
				} `json:"entity"`
			} `json:"payment"`
			Order struct {
				Entity struct {
					ID      string `json:"id"`
					Receipt string `json:"receipt"`
				} `json:"entity"`
			} `json:"order"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("payments: razorpay: decode webhook: %w", err)
	}

	payment := body.Payload.Payment.Entity

	// Razorpay does not send a dedicated event id header, so the payment id plus the event
	// name is used as the idempotency key. Two different events about one payment are
	// distinct; a redelivery of the same event is not.
	eventID := payment.ID + ":" + body.Event
	if payment.ID == "" {
		eventID = body.Payload.Order.Entity.ID + ":" + body.Event
	}
	if strings.TrimPrefix(eventID, ":") == "" {
		return nil, fmt.Errorf("payments: razorpay: webhook identified no payment or order")
	}

	// The receipt is what we set to our own reference at creation time, so it is how the
	// event is tied back to our payment row.
	reference := payment.Receipt
	if reference == "" {
		reference = body.Payload.Order.Entity.Receipt
	}
	if reference == "" {
		if v, ok := payment.Notes["reference"].(string); ok {
			reference = v
		}
	}

	failureReason := payment.ErrorDesc
	if failureReason == "" {
		failureReason = payment.ErrorReason
	}

	return &WebhookEvent{
		EventID:           eventID,
		EventType:         body.Event,
		Reference:         reference,
		ProviderPaymentID: payment.ID,
		ProviderOrderID:   payment.OrderID,
		AmountMinor:       payment.Amount,
		Currency:          payment.Currency,
		// Only these two events change state. Anything else -- payment.authorized, a
		// refund notification -- is recorded and ignored, rather than guessed at.
		Paid:          body.Event == "payment.captured",
		Failed:        body.Event == "payment.failed",
		FailureReason: failureReason,
		Raw:           map[string]any{"event": body.Event, "payment_id": payment.ID},
	}, nil
}

// headerLookup finds a header case-insensitively, since map keys arrive in whatever case
// the caller used.
func headerLookup(headers map[string]string, name string) string {
	if v, ok := headers[name]; ok {
		return v
	}
	lower := strings.ToLower(name)
	for k, v := range headers {
		if strings.ToLower(k) == lower {
			return v
		}
	}
	return ""
}

// truncate bounds a string included in an error message, so a large upstream error body
// cannot flood the logs.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
