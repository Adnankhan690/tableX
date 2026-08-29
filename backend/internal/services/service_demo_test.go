package services

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"tablex/internal/config"
	"tablex/internal/logger"
	"tablex/internal/mailer"
	"tablex/internal/models"
)

// The two pure decisions inside a demo booking, tested without a database.
//
// Normalisation is the one that matters most, and it is worth stating why: "one demo per phone
// number" is enforced by a UNIQUE index over the stored column, so the rule is only as true as
// this function's promise that the same number always reduces to the same string. A gap here does
// not fail loudly -- it quietly lets the same restaurant book five times.

func TestNormaliseDemoPhone_AcceptsHowPeopleActuallyTypeANumber(t *testing.T) {
	// Every one of these is the SAME number. If any pair disagreed, the uniqueness constraint
	// would see two different rows and the feature's central rule would silently not hold.
	sameNumber := []string{
		"9876543210",
		"+919876543210",
		"+91 98765 43210",
		"91 9876543210",
		"09876543210",
		"98765-43210",
		"(98765) 43210",
		"  9876543210  ",
		"98765.43210",
	}

	for _, raw := range sameNumber {
		got, ok := normaliseDemoPhone(raw)
		if !ok {
			t.Errorf("normaliseDemoPhone(%q): rejected a valid number", raw)
			continue
		}
		if got != "9876543210" {
			t.Errorf("normaliseDemoPhone(%q) = %q, want %q", raw, got, "9876543210")
		}
	}
}

// The 91-prefixed mobile ranges, which an unconditional TrimPrefix("91") destroys.
//
// This is the regression worth naming: 91xxxxxxxx is a live Indian mobile range, so a normaliser
// that strips "91" from anything starting with it tells a restaurant owner their own phone number
// is invalid, and the lead is lost with nothing reporting why. The country code comes off only
// when the LENGTH says it is one.
func TestNormaliseDemoPhone_DoesNotMistakeAMobileFor_ItsOwnCountryCode(t *testing.T) {
	cases := map[string]string{
		// Ten digits that merely happen to open with 91. Nothing may be stripped.
		"9123456780":  "9123456780",
		"91234 56780": "9123456780",
		"9199999999":  "9199999999",
		// Twelve digits: now the leading 91 really is the country code.
		"919123456780":    "9123456780",
		"+919123456780":   "9123456780",
		"+91 91234 56780": "9123456780",
		// Eleven digits with the trunk prefix, and thirteen with both.
		"09123456780":   "9123456780",
		"0919123456780": "9123456780",
	}

	for raw, want := range cases {
		got, ok := normaliseDemoPhone(raw)
		if !ok {
			t.Errorf("normaliseDemoPhone(%q): rejected a valid number", raw)
			continue
		}
		if got != want {
			t.Errorf("normaliseDemoPhone(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestNormaliseDemoPhone_RejectsWhatCannotBeCalledBack(t *testing.T) {
	cases := []struct {
		raw string
		why string
	}{
		{"", "empty"},
		{"   ", "whitespace only"},
		{"98765", "too short"},
		{"98765432101", "too long"},
		{"1234567890", "Indian mobiles do not open with 1"},
		{"5876543210", "Indian mobiles do not open with 5"},
		{"0000000000", "not a mobile"},
		{"9876abc210", "letters"},
		{"98765a43210", "a letter inside an otherwise ten-digit number is a typo, not a separator"},
		{"911234567890", "twelve digits whose remainder is not a mobile"},
		{"+1 415 555 0123", "not an Indian mobile"},
	}

	for _, c := range cases {
		if got, ok := normaliseDemoPhone(c.raw); ok {
			t.Errorf("normaliseDemoPhone(%q) = %q, accepted -- want rejected (%s)", c.raw, got, c.why)
		}
	}
}

// A landing page is a public, unauthenticated form, and its contents are rendered into an HTML
// email that lands in the operator's inbox carrying the deployment's own sender identity. An
// unescaped restaurant name there is a link or an image beacon delivered with that authority.
func TestDemoNotificationHTML_EscapesEveryFieldFromTheForm(t *testing.T) {
	demo := &models.DemoRequest{
		UID:            "dmo_test12345678",
		Name:           `Ravi" <script>alert(1)</script>`,
		RestaurantName: `<img src=x onerror="steal()">Curry & Co`,
		Phone:          "9876543210",
		Email:          `ravi+"><b>@example.test`,
	}

	got := demoNotificationHTML(demo)

	// Checked as raw opening tags rather than as substrings like `onerror=`: html.EscapeString
	// neutralises the angle brackets and quotes but leaves an `=` alone, and `onerror=` sitting
	// in escaped TEXT is inert. What must never appear is a tag the mail client would parse.
	for _, injected := range []string{"<script", "<img", "<b>", `="steal()"`} {
		if strings.Contains(got, injected) {
			t.Errorf("notification body contains unescaped %q:\n%s", injected, got)
		}
	}
	// The content still has to arrive -- escaping that also loses the restaurant's name would
	// make the email useless.
	if !strings.Contains(got, "Curry &amp; Co") {
		t.Errorf("notification body lost the restaurant name:\n%s", got)
	}
	if !strings.Contains(got, "dmo_test12345678") {
		t.Errorf("notification body lost the reference an operator quotes on the callback:\n%s", got)
	}
}

func TestDemoNotificationHTML_SaysSoWhenNoEmailWasGiven(t *testing.T) {
	// Email is the one optional field. The row without one must still produce a readable message
	// rather than an empty cell that looks like a rendering bug.
	demo := &models.DemoRequest{
		UID:            "dmo_test12345678",
		Name:           "Ravi Menon",
		RestaurantName: "Coastal Curry",
		Phone:          "9876543210",
	}

	got := demoNotificationHTML(demo)
	if !strings.Contains(got, "not supplied") {
		t.Errorf("notification body does not say the email was omitted:\n%s", got)
	}
	if strings.Contains(got, "mailto:\"") || strings.Contains(got, `mailto:<`) {
		t.Errorf("notification body rendered an empty mailto link:\n%s", got)
	}
}

// --- the notification path ---

// stubMailer records what it was asked to send instead of sending it.
type stubMailer struct {
	configured bool
	err        error

	mu   sync.Mutex
	sent []mailer.Message
}

func (s *stubMailer) Configured() bool { return s.configured }

func (s *stubMailer) Send(_ context.Context, msg mailer.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	s.sent = append(s.sent, msg)
	return nil
}

func (s *stubMailer) messages() []mailer.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]mailer.Message(nil), s.sent...)
}

// newDemoServiceForNotify builds just enough service to exercise the notification.
//
// No database: notifyDemoBooked reads only the config, the logger and the mailer, and keeping the
// test to those three is what lets it assert the part that has never been exercised end to end --
// that a booked demo actually reaches the sales inbox, addressed correctly.
func newDemoServiceForNotify(t *testing.T, notifyTo string, m mailer.Mailer) *serviceDemo {
	t.Helper()
	return &serviceDemo{Access: &ServiceAccess{
		Cfg:    &config.Config{Email: config.EmailConfig{DemoNotifyEmail: notifyTo}},
		Logger: logger.New(io.Discard, "error", "text"),
		Mailer: m,
	}}
}

// waitForMessages polls until the detached send goroutine has run.
//
// The send is deliberately off the request (see notifyDemoBooked), so the test has to wait for it
// rather than assert immediately after the call returns.
func waitForMessages(t *testing.T, stub *stubMailer, want int) []mailer.Message {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if got := stub.messages(); len(got) >= want {
			return got
		}
		time.Sleep(5 * time.Millisecond)
	}
	return stub.messages()
}

func TestNotifyDemoBooked_EmailsTheSalesInboxWithTheOwnerAsReplyTo(t *testing.T) {
	stub := &stubMailer{configured: true}
	svc := newDemoServiceForNotify(t, "sales@tabley.in", stub)

	demo := &models.DemoRequest{
		UID:            "dmo_test12345678",
		Name:           "Ravi Menon",
		RestaurantName: "Coastal Curry",
		Phone:          "9876543210",
		Email:          "ravi@coastalcurry.test",
	}

	svc.notifyDemoBooked(t.Context(), demo)

	sent := waitForMessages(t, stub, 1)
	if len(sent) != 1 {
		t.Fatalf("got %d notifications, want exactly 1 -- a booked demo that nobody is told about is the whole failure this feature exists to avoid", len(sent))
	}

	msg := sent[0]
	if len(msg.To) != 1 || msg.To[0] != "sales@tabley.in" {
		t.Errorf("recipient = %v, want the configured demo inbox", msg.To)
	}
	// Reply-To is the owner, not the deployment. Without it, hitting reply writes to noreply@.
	if msg.ReplyTo != "ravi@coastalcurry.test" {
		t.Errorf("replyTo = %q, want the owner's address", msg.ReplyTo)
	}
	// The subject is what the operator sees in a list of unread mail, so the restaurant's name
	// has to be in it rather than only in the body.
	if !strings.Contains(msg.Subject, "Coastal Curry") {
		t.Errorf("subject = %q, want the restaurant name in it", msg.Subject)
	}
	if !strings.Contains(msg.HTML, "9876543210") {
		t.Errorf("body does not carry the number to call back:\n%s", msg.HTML)
	}
}

func TestNotifyDemoBooked_SendsNothingRatherThanFailingWhenMailIsOff(t *testing.T) {
	// The ordinary state of every local machine. It must be quiet and harmless, not an error per
	// lead -- and above all it must not panic on the nil-shaped path.
	for name, svc := range map[string]*serviceDemo{
		"no provider": newDemoServiceForNotify(t, "sales@tabley.in", &stubMailer{configured: false}),
		"no inbox":    newDemoServiceForNotify(t, "", &stubMailer{configured: true}),
	} {
		demo := &models.DemoRequest{UID: "dmo_test12345678", RestaurantName: "Coastal Curry", Phone: "9876543210"}
		svc.notifyDemoBooked(t.Context(), demo)

		if stub, ok := svc.Access.Mailer.(*stubMailer); ok {
			if got := waitForMessages(t, stub, 1); len(got) != 0 {
				t.Errorf("%s: sent %d messages, want none", name, len(got))
			}
		}
	}
}

func TestNotifyDemoBooked_SurvivesAProviderFailure(t *testing.T) {
	// The lead is already committed by the time this runs, so a mail outage must cost the
	// notification and nothing else. What is being asserted is that the call returns normally --
	// a panic in the detached goroutine would take the whole process down with it.
	stub := &stubMailer{configured: true, err: errors.New("provider is down")}
	svc := newDemoServiceForNotify(t, "sales@tabley.in", stub)

	svc.notifyDemoBooked(t.Context(), &models.DemoRequest{
		UID: "dmo_test12345678", RestaurantName: "Coastal Curry", Phone: "9876543210",
	})

	// Give the goroutine time to run and fail. Reaching here without a panic is the assertion.
	time.Sleep(50 * time.Millisecond)
}
