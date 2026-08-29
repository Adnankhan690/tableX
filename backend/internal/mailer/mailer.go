// Package mailer sends transactional email.
//
// It exists because the application now has two reasons to send one -- a staff member's password
// reset code, and a demo request landing in the sales inbox -- and the second one arriving would
// otherwise have meant a second copy of the same forty lines of Brevo JSON. A copy is not a
// tidiness problem here: the sender identity, the timeout and the "which status codes mean it
// went" rule are decisions, and two copies means two answers the day one of them is changed.
//
// The interface is deliberately smaller than Brevo's API. Nothing in this application needs
// attachments, templates, scheduling or a CC list, and a method that exists is a method someone
// will eventually reach for.
package mailer

import (
	"context"
	"errors"
	"strings"
)

// ErrNotConfigured is returned by every send on a deployment with no email provider.
//
// A named error rather than a silent success, so a caller can decide: the demo service treats it
// as "the lead is saved, the notification is not" and answers the prospect anyway, where a
// password reset has nothing to fall back on.
var ErrNotConfigured = errors.New("mailer: no email provider is configured")

// Message is one email. HTML only -- every message this application sends is a short formatted
// block, and offering a plain-text alternative that nobody fills in produces worse deliverability
// than not offering one.
type Message struct {
	// To is the recipient list. Empty is a programming error, and Send rejects it rather than
	// asking the provider what it thinks.
	To []string
	// ReplyTo, when set, is where a human's reply goes.
	//
	// Load-bearing for the demo notification: the message is sent BY the deployment's sender
	// identity, because that is the only domain it is authorised to send as, but the person who
	// should receive an answer is the restaurant owner. Without this, hitting reply writes to
	// noreply@.
	ReplyTo string
	Subject string
	HTML    string
}

// Mailer sends messages, or reports that it cannot.
type Mailer interface {
	// Configured reports whether this deployment can actually send.
	//
	// Exposed so a caller can decide BEFORE doing work -- and so the demo service can log
	// "notification skipped" once at the right level instead of an error per lead on a local
	// machine that was never going to have an API key.
	Configured() bool
	Send(ctx context.Context, msg Message) error
}

// valid rejects the two mistakes that are ours rather than the provider's.
func (m Message) valid() error {
	recipients := 0
	for _, addr := range m.To {
		if strings.TrimSpace(addr) != "" {
			recipients++
		}
	}
	if recipients == 0 {
		return errors.New("mailer: message has no recipient")
	}
	if strings.TrimSpace(m.Subject) == "" {
		return errors.New("mailer: message has no subject")
	}
	return nil
}
