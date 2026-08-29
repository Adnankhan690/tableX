package services

import (
	"context"
	"fmt"
	"html"
	"regexp"
	"strings"
	"time"

	"tablex/internal/mailer"
	"tablex/internal/models"
	"tablex/internal/repositories"
	"tablex/internal/response"
	"tablex/internal/types"
	"tablex/internal/utils"
)

type serviceDemo struct {
	Access *ServiceAccess
}

// NewServiceDemo builds the landing page's demo-request service.
func NewServiceDemo(access *ServiceAccess) ServiceDemoMethods {
	return &serviceDemo{Access: access}
}

// indianMobile is ten digits opening 6-9, applied AFTER the separators and country code come off.
//
// Deliberately loose about everything else. The only job of this check is to catch a slip of the
// thumb: a validator strict enough to be interesting will one day reject a real restaurant's real
// number, and the cost of that is a lost customer, where the cost of letting a bad number through
// is one wasted dial. The landing page applies the identical rule so the reader is told before
// they submit rather than after (apps/diner marketing sections/book-demo.tsx).
var indianMobile = regexp.MustCompile(`^[6-9]\d{9}$`)

// phoneNoise is the separators a person types into a phone field, plus the leading plus.
//
// Deliberately a closed set rather than "everything that is not a digit": stripping arbitrary
// characters would turn "98765a43210" into a valid-looking number, and a typo silently becoming
// someone else's mobile is worse than being asked to retype it.
var phoneNoise = regexp.MustCompile(`[\s\-().+]`)

// normaliseDemoPhone reduces a typed number to its ten canonical digits.
//
// THIS FUNCTION IS WHAT MAKES "ONE DEMO PER NUMBER" TRUE. The uniqueness rule lives on a UNIQUE
// index over the stored column, so it can only mean "the same number" if every write reduces the
// same number to the same string first -- otherwise "+91 98765 43210" and "9876543210" are two
// rows and the rule quietly does nothing. Every path that reads or writes demo_request.phone goes
// through here, and none of them should be tempted not to.
//
// The +91 and the leading 0 both come off because both are how an Indian owner writes their own
// mobile, not a different number.
func normaliseDemoPhone(raw string) (string, bool) {
	digits := phoneNoise.ReplaceAllString(strings.TrimSpace(raw), "")

	// The country code and the trunk prefix come off ONLY when the length says that is what they
	// are, never by an unconditional TrimPrefix.
	//
	// This is not defensive tidiness, it is the bug the shape exists to avoid: 91xxxxxxxx is
	// itself a live Indian mobile range, so trimming "91" from anything that starts with it turns
	// 9123456780 -- a real number belonging to a real restaurant -- into an eight-digit fragment
	// that then fails validation. The owner is told their own phone number is invalid, and the
	// lead is lost with nothing anywhere reporting why.
	switch {
	case len(digits) == 13 && strings.HasPrefix(digits, "091"):
		digits = digits[3:]
	case len(digits) == 12 && strings.HasPrefix(digits, "91"):
		digits = digits[2:]
	case len(digits) == 11 && strings.HasPrefix(digits, "0"):
		digits = digits[1:]
	}

	if !indianMobile.MatchString(digits) {
		return "", false
	}
	return digits, true
}

// BookDemo records a demo request and notifies the sales inbox.
func (s *serviceDemo) BookDemo(
	ctx context.Context,
	req *types.RequestBookDemo,
) (*types.ResponseBookDemo, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	name := strings.TrimSpace(req.Name)
	restaurantName := strings.TrimSpace(req.RestaurantName)
	email := strings.ToLower(strings.TrimSpace(req.Email))

	// Trimmed, then re-checked. `binding:"required"` accepts a string of spaces, and a lead named
	// "   " is a row nobody can call back.
	if name == "" || restaurantName == "" {
		return nil, response.ErrInvalidRequest.WithMessage("please tell us your name and your restaurant's name")
	}

	phone, ok := normaliseDemoPhone(req.Phone)
	if !ok {
		return nil, response.ErrDemoInvalidPhone
	}

	// The polite check. It is NOT what enforces the rule -- two submissions can interleave between
	// this read and the insert below, and the route is public, so that race is a stranger with a
	// loop rather than a hypothetical. The UNIQUE index enforces it; this exists so the ordinary
	// case gets a sentence instead of a 500, and both outcomes land on the same 409.
	existing, err := s.Access.Repositories.DemoRequest.GetByPhone(ctx, phone)
	if err != nil {
		if response.IsClientGone(err) {
			return nil, response.ErrClientClosed
		}
		log.Errorf("[BookDemo] lookup by phone failed: %+v", err)
		return nil, response.ErrDemoSaveFailed
	}
	if existing != nil {
		log.Infof("[BookDemo] duplicate request for an already-booked number, uid=%s", existing.UID)
		return nil, response.ErrDemoAlreadyBooked
	}

	demo := &models.DemoRequest{
		UID:            utils.GenerateUID(utils.UIDPrefixDemo),
		Name:           name,
		RestaurantName: restaurantName,
		Phone:          phone,
		Email:          email,
	}

	// One row, one statement -- no transaction. A transaction here would wrap a single insert and
	// buy nothing, and the notification deliberately sits OUTSIDE any such boundary anyway: an
	// email cannot be rolled back, so sending one from inside a transaction that later aborts
	// tells the operator about a lead that does not exist.
	if err := s.Access.Repositories.DemoRequest.Create(ctx, demo); err != nil {
		if repositories.IsUniqueViolation(err) {
			// The lost race. Same answer as the pre-check above: from the owner's side there is no
			// difference between "you already asked" and "you asked twice in the same second".
			log.Infof("[BookDemo] concurrent duplicate for a number already booked")
			return nil, response.ErrDemoAlreadyBooked
		}
		if response.IsClientGone(err) {
			return nil, response.ErrClientClosed
		}
		log.Errorf("[BookDemo] create failed: %+v", err)
		return nil, response.ErrDemoSaveFailed
	}

	log.Infof("[BookDemo] demo booked uid=%s restaurant=%q", demo.UID, restaurantName)

	s.notifyDemoBooked(ctx, demo)

	return &types.ResponseBookDemo{
		UID:         demo.UID,
		Name:        demo.Name,
		RequestedAt: demo.CreatedAt,
	}, nil
}

// notifyDemoTimeout bounds the background send. Comfortably above the mailer's own 10s client
// timeout so the deadline that fires first is the one with the better error message.
const notifyDemoTimeout = 15 * time.Second

// notifyDemoBooked emails the sales inbox that a demo has been booked.
//
// TWO PROPERTIES, AND BOTH ARE DELIBERATE.
//
// It does not block the answer. The lead is already committed, so the owner's confirmation is
// truthful the moment the insert returns, and making them watch a spinner for up to ten seconds
// of somebody else's API is a real cost paid on the one interaction this page exists for.
//
// It does not fail the request. A provider outage must not turn a captured lead into a 500 and an
// owner who believes they were not heard -- the row is the record, the email is the nudge. What a
// failure costs is that nobody is nudged, which is why it is logged at Error: it is a real problem
// for whoever runs this deployment, just not for the person who filled in the form.
//
// The context is detached with WithoutCancel because the request's own context is cancelled the
// moment the response is written, which would abort every one of these sends before it left.
func (s *serviceDemo) notifyDemoBooked(ctx context.Context, demo *models.DemoRequest) {
	to := strings.TrimSpace(s.Access.Cfg.Email.DemoNotifyEmail)
	if to == "" || !s.Access.Mailer.Configured() {
		// Info, not Error. A local machine and a preview deploy both legitimately have no mail
		// provider, and an ERROR line per lead there is how a log stops being read.
		s.Access.Logger.With(ctx).Infof(
			"[BookDemo] no demo notification sent for uid=%s: mail is not configured", demo.UID)
		return
	}

	detached := context.WithoutCancel(ctx)
	go func() {
		sendCtx, cancel := context.WithTimeout(detached, notifyDemoTimeout)
		defer cancel()

		msg := mailer.Message{
			To:      []string{to},
			Subject: fmt.Sprintf("Demo request — %s", demo.RestaurantName),
			// Reply-To is the owner, not the deployment. The point of this email is that someone
			// reads it and gets in touch; without this, hitting reply writes to noreply@.
			ReplyTo: demo.Email,
			HTML:    demoNotificationHTML(demo),
		}

		if err := s.Access.Mailer.Send(sendCtx, msg); err != nil {
			// Carries the uid rather than the contact details, so the lead can be found in the
			// database from the log line without the log becoming a copy of it.
			s.Access.Logger.With(detached).Errorf(
				"[BookDemo] notification email failed for uid=%s: %v", demo.UID, err)
			return
		}
		s.Access.Logger.With(detached).Infof(
			"[BookDemo] notification email sent for uid=%s", demo.UID)
	}()
}

// demoNotificationHTML renders the operator's email.
//
// EVERY INTERPOLATED VALUE IS ESCAPED. All four came from an unauthenticated public form minutes
// ago, and the destination is an HTML mail client belonging to whoever runs this deployment --
// an unescaped restaurant name is a link, an image beacon or worse, delivered straight into the
// operator's inbox with the deployment's own domain as the sender. The phone is escaped too even
// though it is ten digits by construction: a rule that has exceptions is a rule that gets one
// more the next time this template is edited.
func demoNotificationHTML(demo *models.DemoRequest) string {
	emailRow := "<tr><td style=\"padding:4px 12px 4px 0;color:#6b7280\">Email</td>" +
		"<td style=\"padding:4px 0\">not supplied</td></tr>"
	if demo.Email != "" {
		emailRow = fmt.Sprintf(
			"<tr><td style=\"padding:4px 12px 4px 0;color:#6b7280\">Email</td>"+
				"<td style=\"padding:4px 0\"><a href=\"mailto:%s\">%s</a></td></tr>",
			html.EscapeString(demo.Email), html.EscapeString(demo.Email))
	}

	return fmt.Sprintf(`<html>
<body style="font-family:sans-serif;padding:24px;color:#111827">
  <h2 style="margin:0 0 4px">New demo request</h2>
  <p style="margin:0 0 20px;color:#6b7280">%s wants to be shown tableX.</p>
  <table style="border-collapse:collapse;font-size:15px">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Restaurant</td><td style="padding:4px 0"><strong>%s</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Name</td><td style="padding:4px 0">%s</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Phone</td><td style="padding:4px 0"><a href="tel:+91%s">+91 %s</a></td></tr>
    %s
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Reference</td><td style="padding:4px 0"><code>%s</code></td></tr>
  </table>
  <p style="margin:20px 0 0;color:#6b7280;font-size:13px">
    Reply to this email to reach them, or call the number above. One request is recorded per phone
    number, so this is the only notification you will get for it.
  </p>
</body>
</html>`,
		html.EscapeString(demo.RestaurantName),
		html.EscapeString(demo.RestaurantName),
		html.EscapeString(demo.Name),
		html.EscapeString(demo.Phone),
		html.EscapeString(demo.Phone),
		emailRow,
		html.EscapeString(demo.UID),
	)
}
