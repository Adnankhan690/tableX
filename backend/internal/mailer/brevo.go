package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"tablex/internal/config"
)

// brevoEndpoint is the transactional send. A field on the struct rather than a constant used
// inline, so the tests can point it at an httptest server -- the payload shape is the part worth
// asserting, and it is unassertable if the URL is baked into the call.
const brevoEndpoint = "https://api.brevo.com/v3/smtp/email"

// sendTimeout bounds one send.
//
// Ten seconds, and it matters more than it looks: this call sits inside an HTTP handler, so a
// provider that accepts the connection and then stalls would hold a request open until the
// server's own write timeout killed it, and the diner-facing timeout is 15s (packages/api-client).
// Failing at 10 leaves room to answer.
const sendTimeout = 10 * time.Second

type brevo struct {
	apiKey      string
	senderName  string
	senderEmail string
	endpoint    string
	client      *http.Client
}

// New returns the mailer this configuration describes.
//
// An unknown provider, or a known one with no key, yields the unconfigured mailer rather than an
// error: a deployment with no email is a legitimate state (every local machine is one), and the
// callers already handle ErrNotConfigured. Boot failing over a missing optional key would be a
// worse trade -- see config.Validate for the things that genuinely must stop a boot.
func New(cfg config.EmailConfig) Mailer {
	if strings.ToLower(strings.TrimSpace(cfg.Provider)) != "brevo" {
		return NewUnconfigured()
	}
	if strings.TrimSpace(cfg.BrevoAPIKey) == "" || strings.TrimSpace(cfg.SenderEmail) == "" {
		return NewUnconfigured()
	}
	return &brevo{
		apiKey:      cfg.BrevoAPIKey,
		senderName:  cfg.SenderName,
		senderEmail: cfg.SenderEmail,
		endpoint:    brevoEndpoint,
		client:      &http.Client{Timeout: sendTimeout},
	}
}

func (b *brevo) Configured() bool { return true }

// brevoPayload is Brevo's v3 transactional body, narrowed to the fields this application sets.
type brevoPayload struct {
	Sender      brevoAddress   `json:"sender"`
	To          []brevoAddress `json:"to"`
	ReplyTo     *brevoAddress  `json:"replyTo,omitempty"`
	Subject     string         `json:"subject"`
	HtmlContent string         `json:"htmlContent"`
}

type brevoAddress struct {
	Name  string `json:"name,omitempty"`
	Email string `json:"email"`
}

func (b *brevo) Send(ctx context.Context, msg Message) error {
	if err := msg.valid(); err != nil {
		return err
	}

	payload := brevoPayload{
		Sender:      brevoAddress{Name: b.senderName, Email: b.senderEmail},
		Subject:     msg.Subject,
		HtmlContent: msg.HTML,
	}
	for _, addr := range msg.To {
		if trimmed := strings.TrimSpace(addr); trimmed != "" {
			payload.To = append(payload.To, brevoAddress{Email: trimmed})
		}
	}
	if replyTo := strings.TrimSpace(msg.ReplyTo); replyTo != "" {
		payload.ReplyTo = &brevoAddress{Email: replyTo}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("mailer: encode payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("mailer: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("api-key", b.apiKey)

	resp, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("mailer: send: %w", err)
	}
	defer resp.Body.Close()

	// 201 is Brevo's success for a queued send and 202 for a scheduled one; 200 is accepted here
	// because the API has answered with it historically and treating a success as a failure would
	// send the message twice on the retry.
	if resp.StatusCode != http.StatusOK &&
		resp.StatusCode != http.StatusCreated &&
		resp.StatusCode != http.StatusAccepted {
		// The body is read but NOT wrapped into the error verbatim beyond a short prefix: it can
		// echo the recipient address, and this error is logged.
		return fmt.Errorf("mailer: provider returned %d", resp.StatusCode)
	}
	return nil
}
