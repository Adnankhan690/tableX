package payments

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// UPIStatic builds a UPI deep link straight from the restaurant's own VPA.
//
// This is the v1 default (DECISIONS.md D2). It needs no gateway account, charges no fee,
// and works the day the restaurant deploys -- which matters because gateway onboarding and
// KYC take longer than building this platform.
//
// What it cannot do is confirm that money arrived. A UPI transfer between a diner's bank
// and the restaurant's is invisible to this server. The diner app therefore shows
// "awaiting confirmation" and a staff member taps Mark paid once they see the credit. That
// is the same trust model as cash, which is what these restaurants use today, and
// Capabilities().AutoConfirms == false is how the rest of the system knows not to wait for
// an event that will never come.
type UPIStatic struct {
	// noteTemplate produces the transaction note. {{order}} and {{ref}} are substituted.
	noteTemplate string
}

// NewUPIStatic builds the static-UPI provider. An empty template falls back to a sensible
// default rather than producing an empty note, because the note is the only thing tying a
// bank credit back to an order.
func NewUPIStatic(noteTemplate string) *UPIStatic {
	if strings.TrimSpace(noteTemplate) == "" {
		noteTemplate = "Order {{order}} ref {{ref}}"
	}
	return &UPIStatic{noteTemplate: noteTemplate}
}

// Name implements Provider.
func (u *UPIStatic) Name() string { return "upi_static" }

// Capabilities implements Provider. AutoConfirms is false, and that single false is what
// drives the manual-confirmation path through the whole application.
func (u *UPIStatic) Capabilities() Capabilities {
	return Capabilities{
		AutoConfirms:      false,
		SendsWebhooks:     false,
		ProducesIntentURL: true,
		ProducesQR:        true,
		SupportsRefund:    false,
	}
}

// CreateIntent builds the upi://pay deep link.
func (u *UPIStatic) CreateIntent(_ context.Context, in IntentInput) (*Intent, error) {
	vpa := strings.TrimSpace(in.PayeeVPA)
	if vpa == "" {
		return nil, ErrNotConfigured
	}
	if in.AmountMinor <= 0 {
		return nil, fmt.Errorf("payments: upi_static: amount must be positive, got %d", in.AmountMinor)
	}
	// UPI is an Indian rails system and the spec has no notion of another currency.
	// Accepting one here would build a link a diner's app silently rejects.
	if in.Currency != "" && !strings.EqualFold(in.Currency, "INR") {
		return nil, fmt.Errorf("payments: upi_static: only INR is supported, got %q", in.Currency)
	}

	payeeName := strings.TrimSpace(in.PayeeName)
	if payeeName == "" {
		payeeName = strings.TrimSpace(in.RestaurantName)
	}
	if payeeName == "" {
		// The payee name is displayed in the diner's UPI app as who they are paying. A
		// blank one reads as a scam, so refuse rather than send an unlabelled request.
		return nil, ErrNotConfigured
	}

	note := u.renderNote(in)

	// Parameters per the UPI deep-link spec: pa payee address, pn payee name, am amount,
	// cu currency, tr transaction reference, tn transaction note.
	//
	// Amount must be a decimal string with two places -- the one place a rupee value is
	// formatted as text, done here from the integer paise so no float is involved.
	q := url.Values{}
	q.Set("pa", vpa)
	q.Set("pn", payeeName)
	q.Set("am", formatAmountForUPI(in.AmountMinor))
	q.Set("cu", "INR")
	q.Set("tr", in.Reference)
	q.Set("tn", note)

	// Built by hand rather than with url.URL: "upi" is not a hierarchical scheme, and
	// url.URL would emit "upi://pay" only with an empty Host, which is fragile to read.
	intentURL := "upi://pay?" + q.Encode()

	return &Intent{
		IntentURL:                  intentURL,
		RequiresManualConfirmation: true,
		Raw: map[string]any{
			"provider":  u.Name(),
			"payee_vpa": vpa,
			"reference": in.Reference,
			"note":      note,
		},
	}, nil
}

// VerifyWebhook implements Provider. Static UPI has no callback channel at all, so this is
// unsupported rather than a no-op -- a no-op would let a crafted request settle an order.
func (u *UPIStatic) VerifyWebhook(_ context.Context, _ []byte, _ map[string]string) (*WebhookEvent, error) {
	return nil, ErrUnsupported
}

// renderNote substitutes the template placeholders and clamps the result.
func (u *UPIStatic) renderNote(in IntentInput) string {
	note := strings.ReplaceAll(u.noteTemplate, "{{order}}", in.OrderNumber)
	note = strings.ReplaceAll(note, "{{ref}}", in.Reference)
	note = strings.ReplaceAll(note, "{{restaurant}}", in.RestaurantName)
	if in.Note != "" {
		note = in.Note
	}
	// UPI apps truncate long notes, and some reject them outright. Trimming here keeps the
	// reference -- the part staff actually match on -- from being the half that is cut.
	const maxNoteLen = 50
	if len(note) > maxNoteLen {
		note = note[:maxNoteLen]
	}
	return note
}

// formatAmountForUPI renders integer paise as the "123.45" string the spec requires,
// without ever converting to a float.
func formatAmountForUPI(amountMinor int64) string {
	return fmt.Sprintf("%d.%02d", amountMinor/100, amountMinor%100)
}
