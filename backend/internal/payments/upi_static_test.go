package payments

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"strings"
	"testing"
)

func TestUPIStatic_CreateIntent_BuildsValidDeepLink(t *testing.T) {
	p := NewUPIStatic("Order {{order}} ref {{ref}}")

	got, err := p.CreateIntent(context.Background(), IntentInput{
		OrderUID:       "ord_abc",
		OrderNumber:    "A-014",
		AmountMinor:    24950, // Rs 249.50
		Currency:       "INR",
		Reference:      "TXABCD1234",
		PayeeVPA:       "restaurant@upi",
		PayeeName:      "Spice Garden",
		RestaurantName: "Spice Garden",
	})
	if err != nil {
		t.Fatalf("CreateIntent: %v", err)
	}

	if !strings.HasPrefix(got.IntentURL, "upi://pay?") {
		t.Fatalf("intent URL has the wrong scheme: %q", got.IntentURL)
	}

	q, err := url.ParseQuery(strings.TrimPrefix(got.IntentURL, "upi://pay?"))
	if err != nil {
		t.Fatalf("intent URL query does not parse: %v", err)
	}

	// The exact parameters a UPI app reads. A wrong or missing one means the diner's app
	// either refuses the link or -- worse -- pays the wrong amount.
	checks := map[string]string{
		"pa": "restaurant@upi",
		"pn": "Spice Garden",
		"am": "249.50",
		"cu": "INR",
		"tr": "TXABCD1234",
	}
	for key, want := range checks {
		if got := q.Get(key); got != want {
			t.Errorf("query %q = %q, want %q", key, got, want)
		}
	}
	if note := q.Get("tn"); !strings.Contains(note, "TXABCD1234") {
		t.Errorf("transaction note %q does not carry the reference, so staff cannot reconcile it", note)
	}

	// Static UPI cannot observe a bank transfer, so it must say so (DECISIONS.md D2).
	if !got.RequiresManualConfirmation {
		t.Error("RequiresManualConfirmation is false; static UPI cannot auto-confirm")
	}
}

func TestUPIStatic_AmountFormatting(t *testing.T) {
	// The one place a rupee value becomes a decimal string. Every case here is exact
	// integer arithmetic -- no float rounding anywhere (DECISIONS.md D7).
	cases := []struct {
		minor int64
		want  string
	}{
		{1, "0.01"},
		{10, "0.10"},
		{99, "0.99"},
		{100, "1.00"},
		{2495, "24.95"},
		{24950, "249.50"},
		{100000, "1000.00"},
		{123456789, "1234567.89"},
	}
	for _, tc := range cases {
		if got := formatAmountForUPI(tc.minor); got != tc.want {
			t.Errorf("formatAmountForUPI(%d) = %q, want %q", tc.minor, got, tc.want)
		}
	}
}

func TestUPIStatic_RejectsMissingConfiguration(t *testing.T) {
	p := NewUPIStatic("")
	base := IntentInput{AmountMinor: 1000, Reference: "TX1", PayeeName: "X", PayeeVPA: "a@upi"}

	t.Run("no VPA", func(t *testing.T) {
		in := base
		in.PayeeVPA = ""
		if _, err := p.CreateIntent(context.Background(), in); !errors.Is(err, ErrNotConfigured) {
			t.Errorf("want ErrNotConfigured, got %v", err)
		}
	})

	t.Run("no payee name", func(t *testing.T) {
		// A UPI request with a blank payee reads as a scam in the diner's app, so it is
		// refused rather than sent unlabelled.
		in := base
		in.PayeeName = ""
		in.RestaurantName = ""
		if _, err := p.CreateIntent(context.Background(), in); !errors.Is(err, ErrNotConfigured) {
			t.Errorf("want ErrNotConfigured, got %v", err)
		}
	})

	t.Run("zero amount", func(t *testing.T) {
		in := base
		in.AmountMinor = 0
		if _, err := p.CreateIntent(context.Background(), in); err == nil {
			t.Error("a zero-amount payment was accepted")
		}
	})

	t.Run("non-INR currency", func(t *testing.T) {
		// UPI has no notion of another currency; accepting one would build a link the
		// diner's app silently rejects.
		in := base
		in.Currency = "USD"
		if _, err := p.CreateIntent(context.Background(), in); err == nil {
			t.Error("a USD payment was accepted on UPI rails")
		}
	})
}

func TestUPIStatic_FallsBackToRestaurantName(t *testing.T) {
	p := NewUPIStatic("")
	got, err := p.CreateIntent(context.Background(), IntentInput{
		AmountMinor:    500,
		Reference:      "TX9",
		PayeeVPA:       "x@upi",
		RestaurantName: "Curry House",
	})
	if err != nil {
		t.Fatalf("CreateIntent: %v", err)
	}
	if !strings.Contains(got.IntentURL, url.QueryEscape("Curry House")) {
		t.Errorf("payee name did not fall back to the restaurant name: %q", got.IntentURL)
	}
}

func TestUPIStatic_NoteIsBounded(t *testing.T) {
	// Some UPI apps reject an over-long note outright, which would break checkout.
	p := NewUPIStatic(strings.Repeat("very long template ", 20))
	got, err := p.CreateIntent(context.Background(), IntentInput{
		AmountMinor: 100, Reference: "TX1", PayeeVPA: "a@upi", PayeeName: "N",
	})
	if err != nil {
		t.Fatalf("CreateIntent: %v", err)
	}
	q, _ := url.ParseQuery(strings.TrimPrefix(got.IntentURL, "upi://pay?"))
	if len(q.Get("tn")) > 50 {
		t.Errorf("transaction note is %d chars, over the 50-char bound", len(q.Get("tn")))
	}
}

func TestUPIStatic_WebhookIsUnsupported(t *testing.T) {
	// Must be unsupported, not a permissive no-op: a no-op would turn the webhook endpoint
	// into an unauthenticated "mark this order paid" API.
	p := NewUPIStatic("")
	if _, err := p.VerifyWebhook(context.Background(), []byte(`{}`), nil); !errors.Is(err, ErrUnsupported) {
		t.Errorf("want ErrUnsupported, got %v", err)
	}
}

func TestUPIStatic_Capabilities(t *testing.T) {
	c := NewUPIStatic("").Capabilities()
	if c.AutoConfirms {
		t.Error("AutoConfirms must be false: a bank transfer is invisible to this server")
	}
	if c.SendsWebhooks {
		t.Error("SendsWebhooks must be false")
	}
	if !c.ProducesIntentURL || !c.ProducesQR {
		t.Error("static UPI does produce an intent URL and a QR")
	}
}

func TestRazorpay_VerifyWebhook_RejectsBadSignature(t *testing.T) {
	r := NewRazorpay("key", "secret", "whsec", "")
	body := []byte(`{"event":"payment.captured"}`)

	t.Run("wrong signature", func(t *testing.T) {
		_, err := r.VerifyWebhook(context.Background(), body, map[string]string{
			"X-Razorpay-Signature": "deadbeef",
		})
		if !errors.Is(err, ErrSignatureInvalid) {
			t.Errorf("want ErrSignatureInvalid, got %v", err)
		}
	})

	t.Run("absent signature", func(t *testing.T) {
		// The unsigned request is the actual attack: someone who learns the webhook URL and
		// posts a captured event.
		if _, err := r.VerifyWebhook(context.Background(), body, nil); !errors.Is(err, ErrSignatureInvalid) {
			t.Errorf("want ErrSignatureInvalid, got %v", err)
		}
	})
}

func TestRazorpay_VerifyWebhook_AcceptsValidSignature(t *testing.T) {
	const secret = "whsec_test"
	r := NewRazorpay("key", "secret", secret, "")

	body := []byte(`{"event":"payment.captured","payload":{"payment":{"entity":{` +
		`"id":"pay_123","order_id":"order_456","amount":24950,"currency":"INR",` +
		`"status":"captured","receipt":"TXABCD1234"}}}}`)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))

	got, err := r.VerifyWebhook(context.Background(), body, map[string]string{
		"X-Razorpay-Signature": sig,
	})
	if err != nil {
		t.Fatalf("VerifyWebhook: %v", err)
	}

	if !got.Paid {
		t.Error("payment.captured did not set Paid")
	}
	if got.AmountMinor != 24950 {
		t.Errorf("AmountMinor = %d, want 24950", got.AmountMinor)
	}
	if got.Reference != "TXABCD1234" {
		t.Errorf("Reference = %q, want the receipt we set at creation", got.Reference)
	}
	if got.ProviderPaymentID != "pay_123" {
		t.Errorf("ProviderPaymentID = %q", got.ProviderPaymentID)
	}
	// The event id is the idempotency key; without it a redelivery would settle twice.
	if got.EventID == "" {
		t.Error("EventID is empty, so redeliveries could not be deduplicated")
	}
}

func TestRazorpay_VerifyWebhook_HeaderLookupIsCaseInsensitive(t *testing.T) {
	// Header case varies by proxy, and a case-sensitive lookup would reject genuine events.
	const secret = "s"
	r := NewRazorpay("k", "ks", secret, "")
	body := []byte(`{"event":"payment.failed","payload":{"payment":{"entity":{"id":"pay_1"}}}}`)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))

	got, err := r.VerifyWebhook(context.Background(), body, map[string]string{
		"x-razorpay-signature": sig,
	})
	if err != nil {
		t.Fatalf("VerifyWebhook with a lowercased header: %v", err)
	}
	if !got.Failed {
		t.Error("payment.failed did not set Failed")
	}
}

func TestRazorpay_UnconfiguredIsInert(t *testing.T) {
	// With no credentials the adapter must report itself unconfigured so the registry can
	// fall back, rather than half-working.
	r := NewRazorpay("", "", "", "")
	if r.Configured() {
		t.Error("Configured() is true with no credentials")
	}
	if _, err := r.CreateIntent(context.Background(), IntentInput{AmountMinor: 100}); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("CreateIntent: want ErrNotConfigured, got %v", err)
	}
	if _, err := r.VerifyWebhook(context.Background(), []byte(`{}`), nil); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("VerifyWebhook: want ErrNotConfigured, got %v", err)
	}
}

func TestRegistry_FallsBackForUnknownProvider(t *testing.T) {
	// A restaurant configured for a provider this environment has no credentials for must
	// still be able to take payment, on the fallback.
	fallback := NewUPIStatic("")
	reg := NewRegistry(fallback, NewMock())

	got, err := reg.Get("razorpay")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Name() != fallback.Name() {
		t.Errorf("unknown provider resolved to %q, want the fallback %q", got.Name(), fallback.Name())
	}

	if reg.Has("razorpay") {
		t.Error("Has() reported an unregistered provider as present")
	}
	if !reg.Has("mock") {
		t.Error("Has() did not find a registered provider")
	}
}

func TestRegistry_NoFallbackIsAnError(t *testing.T) {
	reg := NewRegistry(nil)
	if _, err := reg.Get("anything"); err == nil {
		t.Error("Get succeeded with no provider and no fallback")
	}
}

func TestRenderQRPNG(t *testing.T) {
	got, err := RenderQRPNG("upi://pay?pa=x@upi&am=10.00", 256)
	if err != nil {
		t.Fatalf("RenderQRPNG: %v", err)
	}
	if len(got) == 0 {
		t.Fatal("RenderQRPNG returned an empty string")
	}

	if _, err := RenderQRPNG("", 256); err == nil {
		t.Error("an empty QR payload was accepted")
	}
}
