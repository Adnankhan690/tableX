package mailer

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tablex/internal/config"
)

// newTestBrevo builds a Brevo mailer pointed at a stub, which is the only way the payload shape
// is assertable -- the thing worth testing here is what goes on the wire, and that is unreachable
// if the endpoint is baked into the call.
func newTestBrevo(endpoint string) *brevo {
	return &brevo{
		apiKey:      "test-key",
		senderName:  "tableX Admin",
		senderEmail: "noreply@tabley.in",
		endpoint:    endpoint,
		client:      &http.Client{Timeout: 2 * time.Second},
	}
}

func TestBrevoSend_PutsTheSenderAndReplyToOnTheWire(t *testing.T) {
	var got brevoPayload
	var apiKey string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiKey = r.Header.Get("api-key")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &got)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	err := newTestBrevo(server.URL).Send(t.Context(), Message{
		To:      []string{"sales@tabley.in"},
		ReplyTo: "ravi@coastalcurry.test",
		Subject: "Demo request",
		HTML:    "<p>hello</p>",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	if apiKey != "test-key" {
		t.Errorf("api-key header = %q, want the configured key", apiKey)
	}
	// The sender is the deployment's authorised identity and the reply-to is the person. Getting
	// these the wrong way round is the failure that looks fine in a test inbox and silently sends
	// every operator reply to noreply@.
	if got.Sender.Email != "noreply@tabley.in" {
		t.Errorf("sender = %q, want the configured sender", got.Sender.Email)
	}
	if got.ReplyTo == nil || got.ReplyTo.Email != "ravi@coastalcurry.test" {
		t.Errorf("replyTo = %+v, want the message's reply address", got.ReplyTo)
	}
	if len(got.To) != 1 || got.To[0].Email != "sales@tabley.in" {
		t.Errorf("to = %+v, want one recipient", got.To)
	}
}

func TestBrevoSend_OmitsReplyToRatherThanSendingAnEmptyOne(t *testing.T) {
	var raw map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &raw)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	// The optional-email case: a demo booked without one must not send `"replyTo": {"email": ""}`,
	// which providers reject outright rather than ignore.
	if err := newTestBrevo(server.URL).Send(t.Context(), Message{
		To:      []string{"sales@tabley.in"},
		Subject: "Demo request",
		HTML:    "<p>hello</p>",
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}

	if _, present := raw["replyTo"]; present {
		t.Errorf("payload carries a replyTo key when none was set: %v", raw)
	}
}

func TestBrevoSend_TreatsAProviderRejectionAsAFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	err := newTestBrevo(server.URL).Send(t.Context(), Message{
		To:      []string{"sales@tabley.in"},
		Subject: "Demo request",
		HTML:    "<p>hello</p>",
	})
	if err == nil {
		t.Fatal("Send: got nil, want an error -- a rejected send reported as success is a lead nobody hears about")
	}
}

func TestBrevoSend_AcceptsEveryStatusTheProviderUsesForSuccess(t *testing.T) {
	// 200, 201 and 202 all mean "we have it". Treating any of them as a failure would send the
	// message a second time on the retry.
	for _, status := range []int{http.StatusOK, http.StatusCreated, http.StatusAccepted} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
		}))

		err := newTestBrevo(server.URL).Send(t.Context(), Message{
			To:      []string{"sales@tabley.in"},
			Subject: "Demo request",
			HTML:    "<p>hello</p>",
		})
		server.Close()

		if err != nil {
			t.Errorf("Send with provider status %d: %v", status, err)
		}
	}
}

func TestSendRejectsAMessageWithNoRecipient(t *testing.T) {
	// Caught here rather than by the provider: a message with no destination is our bug, and
	// finding out from a 400 costs a round trip and a much worse log line.
	err := newTestBrevo("http://127.0.0.1:1").Send(context.Background(), Message{
		To:      []string{"  "},
		Subject: "Demo request",
	})
	if err == nil {
		t.Fatal("Send: got nil, want a rejection for a message with no recipient")
	}
}

func TestNew_FallsBackToUnconfiguredRatherThanFailing(t *testing.T) {
	// A deployment with no email provider is legitimate -- every local machine is one. What must
	// not happen is a mailer that reports Configured() and then fails at the point of use.
	cases := map[string]config.EmailConfig{
		"no api key":       {Provider: "brevo", SenderEmail: "noreply@tabley.in"},
		"no sender":        {Provider: "brevo", BrevoAPIKey: "k"},
		"unknown provider": {Provider: "postmark", BrevoAPIKey: "k", SenderEmail: "noreply@tabley.in"},
		"no provider":      {},
	}

	for name, cfg := range cases {
		m := New(cfg)
		if m.Configured() {
			t.Errorf("New(%s): reports configured, want the unconfigured mailer", name)
		}
		if err := m.Send(context.Background(), Message{To: []string{"a@b.test"}, Subject: "s"}); err != ErrNotConfigured {
			t.Errorf("New(%s).Send: got %v, want ErrNotConfigured", name, err)
		}
	}

	configured := New(config.EmailConfig{
		Provider:    "Brevo",
		BrevoAPIKey: "k",
		SenderEmail: "noreply@tabley.in",
	})
	if !configured.Configured() {
		t.Error("New with a complete config: reports unconfigured -- the provider name is compared case-insensitively")
	}
}
