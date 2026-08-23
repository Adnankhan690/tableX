package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"tablex/internal/models"
	"tablex/internal/payments"
	"tablex/internal/response"
	"tablex/internal/types"
	"tablex/internal/utils"
)

// qrRenderSize is the pixel size for a payment QR shown on a phone screen. Large enough for
// a second device's camera to read off the display, small enough not to bloat the response.
const qrRenderSize = 320

type servicePayment struct {
	Access *ServiceAccess
	// orders is held concretely so settling a payment completes an order through the state
	// machine and the audit log, rather than writing the status column behind its back. That
	// is what makes a webhook-driven completion indistinguishable from a staff-driven one in
	// the timeline.
	orders *ServiceOrder
}

// NewServicePayment builds the payment service.
func NewServicePayment(access *ServiceAccess, orders *ServiceOrder) ServicePaymentMethods {
	return &servicePayment{Access: access, orders: orders}
}

// StartIntentForOrder creates the payment row for a freshly placed order.
//
// Called by the order controller after Place commits, not by the order service, because the
// payment service already depends on the order service and the reverse would be a cycle.
func (s *servicePayment) StartIntentForOrder(
	ctx context.Context,
	order *models.Order,
	restaurant *models.Restaurant,
) (*types.PaymentView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	// A counter order has no provider interaction at all. The row exists so that the payment
	// still has a reference staff can quote and an auditable settlement event later.
	if order.PaymentMethod == models.PaymentMethodCounter {
		payment := &models.Payment{
			UID:          utils.GenerateUID(utils.UIDPrefixPayment),
			RestaurantID: order.RestaurantID,
			OrderID:      order.ID,
			Provider:     models.PaymentProviderCounter,
			Method:       models.PaymentMethodCounter,
			AmountMinor:  order.TotalMinor,
			Currency:     order.Currency,
			Status:       models.PaymentStatusPending,
			Reference:    utils.GeneratePaymentReference(),
		}
		if err := s.Access.Repositories.Payment.Create(ctx, nil, payment); err != nil {
			log.Errorf("[StartIntentForOrder] counter payment insert failed: %+v", err)
			return nil, response.ErrPaymentCreateFailed
		}
		return toPaymentView(payment, "", true), nil
	}

	provider, err := s.Access.Payments.Get(string(restaurant.PaymentProvider))
	if err != nil {
		log.Errorf("[StartIntentForOrder] provider resolution failed: %+v", err)
		return nil, response.ErrPaymentUnsupported
	}
	caps := provider.Capabilities()

	reference := utils.GeneratePaymentReference()

	intent, err := provider.CreateIntent(ctx, payments.IntentInput{
		OrderUID:       order.UID,
		OrderNumber:    order.OrderNumber,
		AmountMinor:    order.TotalMinor,
		Currency:       order.Currency,
		Reference:      reference,
		PayeeVPA:       restaurant.UPIVPA,
		PayeeName:      restaurant.UPIPayeeName,
		RestaurantName: restaurant.Name,
	})
	if err != nil {
		switch {
		case errors.Is(err, payments.ErrNotConfigured):
			// Nothing is broken -- the restaurant has not finished setup, and the diner can
			// still pay at the counter. A 409 with an actionable message beats a 500.
			log.Warnf("[StartIntentForOrder] provider %s unconfigured for restaurant %s",
				provider.Name(), restaurant.Slug)
			return nil, response.ErrUPINotConfigured
		case errors.Is(err, payments.ErrProviderUnavailable):
			log.Errorf("[StartIntentForOrder] provider %s unavailable: %+v", provider.Name(), err)
			return nil, response.ErrPaymentProviderFailed
		default:
			log.Errorf("[StartIntentForOrder] provider %s failed: %+v", provider.Name(), err)
			return nil, response.ErrPaymentCreateFailed
		}
	}

	payment := &models.Payment{
		UID:          utils.GenerateUID(utils.UIDPrefixPayment),
		RestaurantID: order.RestaurantID,
		OrderID:      order.ID,
		// The provider that actually ran, which may differ from the restaurant's configured
		// choice when the registry fell back. Recording the real one is what makes
		// reconciliation possible afterwards.
		Provider:        models.PaymentProviderName(provider.Name()),
		Method:          models.PaymentMethodOnlineUPI,
		AmountMinor:     order.TotalMinor,
		Currency:        order.Currency,
		Status:          models.PaymentStatusPending,
		ProviderOrderID: intent.ProviderOrderID,
		UPIIntentURL:    intent.IntentURL,
		Reference:       reference,
		RawPayload:      models.JSONMap(intent.Raw),
	}

	if err := s.Access.Repositories.Payment.Create(ctx, nil, payment); err != nil {
		log.Errorf("[StartIntentForOrder] payment insert failed: %+v", err)
		return nil, response.ErrPaymentCreateFailed
	}

	view := toPaymentView(payment, s.renderQR(ctx, caps, intent.IntentURL), intent.RequiresManualConfirmation)
	view.ProviderKeyID = intent.ProviderKeyID

	log.Infof("[StartIntentForOrder] payment %s (%s) started for order %s via %s",
		payment.UID, payment.Reference, order.UID, provider.Name())

	return view, nil
}

// renderQR turns an intent URL into a scannable image, when the provider supports it.
//
// A render failure is logged and swallowed: the deep-link button is the primary path and a
// missing QR must not fail a checkout that is otherwise ready to pay.
func (s *servicePayment) renderQR(ctx context.Context, caps payments.Capabilities, intentURL string) string {
	if !caps.ProducesQR || intentURL == "" {
		return ""
	}
	png, err := payments.RenderQRPNG(intentURL, qrRenderSize)
	if err != nil {
		s.Access.Logger.With(ctx).Warnf("[renderQR] %+v", err)
		return ""
	}
	return png
}

// CreateForOrder starts a payment against an already-placed order.
//
// Used when a diner chose "pay at counter" and changed their mind, or when a first attempt
// was abandoned.
func (s *servicePayment) CreateForOrder(
	ctx context.Context,
	guest *GuestPrincipal,
	orderUID string,
	req *types.RequestCreatePayment,
) (*types.PaymentView, *response.ApplicationError) {
	order, appErr := s.orders.loadGuestOrder(ctx, guest, orderUID)
	if appErr != nil {
		return nil, appErr
	}

	if order.PaymentStatus == models.PaymentStatusPaid {
		return nil, response.ErrPaymentAlreadyPaid
	}
	if order.Status.IsTerminal() {
		return nil, response.ErrOrderTerminal
	}

	method := models.PaymentMethod(req.Method)
	if !method.Valid() {
		return nil, response.ErrPaymentMethodInvalid
	}

	restaurant, appErr := loadActiveRestaurant(ctx, s.Access, order.RestaurantID)
	if appErr != nil {
		return nil, appErr
	}

	// The order's recorded method is updated to match, so the admin panel shows what the diner
	// actually chose rather than what they first selected.
	if order.PaymentMethod != method {
		if err := s.Access.Repositories.Order.UpdateFields(ctx, nil, order.ID, map[string]any{
			"payment_method": method,
			"updated_at":     time.Now().UTC(),
		}); err != nil {
			s.Access.Logger.With(ctx).Errorf("[CreateForOrder] method update failed: %+v", err)
			return nil, response.ErrPaymentCreateFailed
		}
		order.PaymentMethod = method
	}

	return s.StartIntentForOrder(ctx, order, restaurant)
}

// GetStatus is what the diner app polls while awaiting confirmation.
//
// Returns the order status alongside the payment status so one request answers both
// questions the diner has on that screen, halving the polling traffic.
func (s *servicePayment) GetStatus(
	ctx context.Context,
	guest *GuestPrincipal,
	orderUID string,
) (*types.ResponsePaymentStatus, *response.ApplicationError) {
	order, appErr := s.orders.loadGuestOrder(ctx, guest, orderUID)
	if appErr != nil {
		return nil, appErr
	}

	payment, appErr := s.latestPayment(ctx, order.ID)
	if appErr != nil {
		return nil, appErr
	}

	requiresManual := true
	if provider, err := s.Access.Payments.Get(string(payment.Provider)); err == nil {
		requiresManual = !provider.Capabilities().AutoConfirms
	}

	return &types.ResponsePaymentStatus{
		Payment:       *toPaymentView(payment, "", requiresManual),
		OrderStatus:   string(order.Status),
		PaymentStatus: string(order.PaymentStatus),
	}, nil
}

// ConfirmByStaff records that a staff member saw the money arrive.
//
// This is the settlement path for cash and for static UPI, which cannot confirm itself
// (DECISIONS.md D2). It is a trust-the-staff action, identical in kind to how cash works
// today, and the actor is recorded so it stays attributable afterwards.
func (s *servicePayment) ConfirmByStaff(
	ctx context.Context,
	actor *StaffPrincipal,
	orderUID string,
	req *types.RequestConfirmPayment,
) (*types.PaymentView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	order, err := s.Access.Repositories.Order.GetByUID(ctx, actor.RestaurantID, orderUID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrOrderNotFound
		}
		log.Errorf("[ConfirmByStaff] order lookup failed: %+v", err)
		return nil, response.ErrOrderFetchFailed
	}
	if order.PaymentStatus == models.PaymentStatusPaid {
		return nil, response.ErrPaymentAlreadyPaid
	}

	payment, appErr := s.latestPayment(ctx, order.ID)
	if appErr != nil {
		return nil, appErr
	}

	note := strings.TrimSpace(req.Note)
	if ref := strings.TrimSpace(req.Reference); ref != "" {
		note = strings.TrimSpace(note + " utr:" + ref)
	}

	if appErr := s.settle(ctx, payment.ID, settleInput{
		ActorID: actor.StaffUID,
		Note:    note,
	}); appErr != nil {
		return nil, appErr
	}

	log.Infof("[ConfirmByStaff] payment %s on order %s confirmed by %s",
		payment.Reference, orderUID, actor.StaffUID)

	fresh, appErr := s.latestPayment(ctx, order.ID)
	if appErr != nil {
		return nil, appErr
	}
	return toPaymentView(fresh, "", false), nil
}

func (s *servicePayment) MarkFailedByStaff(
	ctx context.Context,
	actor *StaffPrincipal,
	orderUID string,
	req *types.RequestMarkPaymentFailed,
) (*types.PaymentView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	order, err := s.Access.Repositories.Order.GetByUID(ctx, actor.RestaurantID, orderUID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrOrderNotFound
		}
		log.Errorf("[MarkFailedByStaff] order lookup failed: %+v", err)
		return nil, response.ErrOrderFetchFailed
	}
	if order.PaymentStatus == models.PaymentStatusPaid {
		// Refusing here rather than allowing a "correction" is deliberate: reversing a
		// settlement is a refund, which is a different operation with different accounting.
		return nil, response.ErrPaymentAlreadyPaid
	}

	payment, appErr := s.latestPayment(ctx, order.ID)
	if appErr != nil {
		return nil, appErr
	}

	now := time.Now().UTC()
	txErr := s.Access.Db.Transaction(ctx, func(tx *gorm.DB) error {
		locked, err := s.Access.Repositories.Payment.LockForUpdate(ctx, tx, payment.ID)
		if err != nil {
			return fmt.Errorf("lock payment: %w", err)
		}
		if locked.Status == models.PaymentStatusPaid {
			return response.ErrPaymentAlreadyPaid
		}

		if err := s.Access.Repositories.Payment.UpdateFields(ctx, tx, locked.ID, map[string]any{
			"status":     models.PaymentStatusFailed,
			"failed_at":  now,
			"updated_at": now,
		}); err != nil {
			return fmt.Errorf("update payment: %w", err)
		}

		return s.Access.Repositories.Order.UpdateFields(ctx, tx, order.ID, map[string]any{
			"payment_status": models.PaymentStatusFailed,
			"updated_at":     now,
		})
	})

	if txErr != nil {
		var appErr *response.ApplicationError
		if errors.As(txErr, &appErr) {
			return nil, appErr
		}
		log.Errorf("[MarkFailedByStaff] %s: %+v", orderUID, txErr)
		return nil, response.ErrPaymentUpdateFailed
	}

	log.Infof("[MarkFailedByStaff] payment %s failed by %s: %s",
		payment.Reference, actor.StaffUID, req.Reason)

	s.Access.publishOrderEvent(
		types.EventPaymentUpdated, actor.RestaurantUID, orderUID, string(order.Status), "")

	fresh, appErr := s.latestPayment(ctx, order.ID)
	if appErr != nil {
		return nil, appErr
	}
	return toPaymentView(fresh, "", false), nil
}

// HandleWebhook verifies, deduplicates and applies a provider callback.
//
// The order of operations below is the security design of this endpoint and must not be
// rearranged. Verification happens before any parsing or database work, because without it
// this route is an unauthenticated "mark any order paid" API for anyone who learns the URL.
func (s *servicePayment) HandleWebhook(
	ctx context.Context,
	providerName string,
	raw []byte,
	headers map[string]string,
) *response.ApplicationError {
	log := s.Access.Logger.With(ctx)

	// A webhook naming a provider this deployment does not run must not fall back to the
	// default, unlike a diner's checkout: falling back would let a caller pick whichever
	// provider had the weakest verification.
	if !s.Access.Payments.Has(providerName) {
		log.Warnf("[HandleWebhook] callback for unregistered provider %q", providerName)
		return response.ErrPaymentUnsupported
	}
	provider, err := s.Access.Payments.Get(providerName)
	if err != nil {
		return response.ErrPaymentUnsupported
	}

	// Step 1: authenticate. Nothing below this line may run on an unverified payload.
	event, err := provider.VerifyWebhook(ctx, raw, headers)
	if err != nil {
		switch {
		case errors.Is(err, payments.ErrSignatureInvalid):
			log.Warnf("[HandleWebhook] signature rejected for provider %s", providerName)
			return response.ErrWebhookSignature
		case errors.Is(err, payments.ErrUnsupported), errors.Is(err, payments.ErrNotConfigured):
			return response.ErrPaymentUnsupported
		default:
			log.Errorf("[HandleWebhook] malformed payload from %s: %+v", providerName, err)
			return response.ErrWebhookMalformed
		}
	}

	// Step 2: deduplicate. Gateways retry as a matter of course, so a redelivery is the
	// normal path rather than an error. The unique index on (provider, event_id) does the
	// work -- a SELECT-then-INSERT would be racy under concurrent redelivery
	// (DECISIONS.md D2).
	ledger := &models.PaymentWebhookEvent{
		Provider:    models.PaymentProviderName(providerName),
		EventID:     event.EventID,
		EventType:   event.EventType,
		Payload:     models.JSONMap(event.Raw),
		SignatureOK: true,
	}
	inserted, err := s.Access.Repositories.Payment.RecordWebhookEvent(ctx, nil, ledger)
	if err != nil {
		log.Errorf("[HandleWebhook] ledger write failed: %+v", err)
		return response.ErrInternal
	}
	if !inserted {
		log.Infof("[HandleWebhook] %s event %s already handled, ignoring", providerName, event.EventID)
		return nil
	}

	// Step 3: resolve our payment. An unknown reference is recorded and ignored rather than
	// erroring -- a webhook for a payment we never created is the provider's problem, and
	// returning 500 would make them retry it forever.
	payment, err := s.Access.Repositories.Payment.GetByReference(ctx, nil, event.Reference)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Warnf("[HandleWebhook] no payment for reference %q, recorded and ignored", event.Reference)
			s.markProcessed(ctx, ledger.ID, "unknown reference")
			return nil
		}
		log.Errorf("[HandleWebhook] payment lookup failed: %+v", err)
		return response.ErrInternal
	}

	// Step 4: verify the amount. Never settle a mismatch. An underpayment silently marked
	// paid is money the restaurant loses without ever finding out.
	if event.Paid && event.AmountMinor != payment.AmountMinor {
		log.Errorf("[HandleWebhook] amount mismatch on %s: provider says %d, order is %d",
			payment.Reference, event.AmountMinor, payment.AmountMinor)
		s.markProcessed(ctx, ledger.ID, fmt.Sprintf(
			"amount mismatch: provider %d, expected %d", event.AmountMinor, payment.AmountMinor))
		return response.ErrPaymentAmountMismatch
	}

	// Step 5: apply.
	switch {
	case event.Paid:
		if appErr := s.settle(ctx, payment.ID, settleInput{
			ActorID:           "system:" + providerName,
			ProviderPaymentID: event.ProviderPaymentID,
			Raw:               event.Raw,
		}); appErr != nil {
			s.markProcessed(ctx, ledger.ID, appErr.ErrorMessage)
			return appErr
		}
		log.Infof("[HandleWebhook] payment %s settled by %s", payment.Reference, providerName)

	case event.Failed:
		now := time.Now().UTC()
		if err := s.Access.Repositories.Payment.UpdateFields(ctx, nil, payment.ID, map[string]any{
			"status":              models.PaymentStatusFailed,
			"failed_at":           now,
			"provider_payment_id": event.ProviderPaymentID,
			"updated_at":          now,
		}); err != nil {
			log.Errorf("[HandleWebhook] failure update failed: %+v", err)
			return response.ErrPaymentUpdateFailed
		}
		if err := s.Access.Repositories.Order.UpdateFields(ctx, nil, payment.OrderID, map[string]any{
			"payment_status": models.PaymentStatusFailed,
			"updated_at":     now,
		}); err != nil {
			log.Errorf("[HandleWebhook] order failure update failed: %+v", err)
		}
		log.Infof("[HandleWebhook] payment %s failed: %s", payment.Reference, event.FailureReason)

	default:
		// A recognised event that changes nothing -- payment.authorized, a refund notice. It is
		// recorded for the audit trail and otherwise ignored, rather than guessed at.
		log.Infof("[HandleWebhook] %s event %s is not state-changing", providerName, event.EventType)
	}

	s.markProcessed(ctx, ledger.ID, "")
	return nil
}

// markProcessed closes out a ledger row. Best-effort: the payment effect has already been
// applied, and failing the webhook now would make the provider retry an action that
// succeeded.
func (s *servicePayment) markProcessed(ctx context.Context, ledgerID int64, errMsg string) {
	if err := s.Access.Repositories.Payment.MarkWebhookProcessed(
		ctx, nil, ledgerID, time.Now().UTC(), errMsg); err != nil {
		s.Access.Logger.With(ctx).Warnf("[markProcessed] ledger %d: %+v", ledgerID, err)
	}
}

// settleInput carries the details of a successful settlement.
type settleInput struct {
	ActorID           string
	ProviderPaymentID string
	Note              string
	Raw               map[string]any
}

// settle marks a payment paid and hands off to the order service.
//
// One implementation for both the staff confirmation and the gateway webhook, so the two
// produce identical audit trails, identical realtime events, and identical order-completion
// behaviour. Two implementations would inevitably diverge on one of the three.
func (s *servicePayment) settle(
	ctx context.Context,
	paymentID int32,
	in settleInput,
) *response.ApplicationError {
	log := s.Access.Logger.With(ctx)
	now := time.Now().UTC()

	var orderID int32

	txErr := s.Access.Db.Transaction(ctx, func(tx *gorm.DB) error {
		// The lock is what stops a staff confirmation and a webhook arriving together from
		// both settling the same payment.
		payment, err := s.Access.Repositories.Payment.LockForUpdate(ctx, tx, paymentID)
		if err != nil {
			return fmt.Errorf("lock payment: %w", err)
		}
		if payment.Status == models.PaymentStatusPaid {
			return response.ErrPaymentAlreadyPaid
		}
		if payment.Status == models.PaymentStatusRefunded {
			return response.ErrPaymentNotPending
		}

		fields := map[string]any{
			"status":     models.PaymentStatusPaid,
			"paid_at":    now,
			"updated_at": now,
		}
		if in.ProviderPaymentID != "" {
			fields["provider_payment_id"] = in.ProviderPaymentID
		}
		if len(in.Raw) > 0 {
			fields["raw_payload"] = models.JSONMap(in.Raw)
		}

		if err := s.Access.Repositories.Payment.UpdateFields(ctx, tx, payment.ID, fields); err != nil {
			return fmt.Errorf("update payment: %w", err)
		}

		orderID = payment.OrderID
		return nil
	})

	if txErr != nil {
		var appErr *response.ApplicationError
		if errors.As(txErr, &appErr) {
			return appErr
		}
		log.Errorf("[settle] payment %d: %+v", paymentID, txErr)
		return response.ErrPaymentUpdateFailed
	}

	// A separate transaction on purpose. The money is settled and committed; if closing the
	// order then fails, the payment must not roll back with it -- a paid payment recorded as
	// pending is far worse than an order left at 'served' that staff can close by hand.
	return s.orders.MarkPaidBySystem(ctx, orderID, in.ActorID)
}

// latestPayment returns the most recent payment attempt on an order.
//
// An order can accumulate several: a failed UPI attempt followed by cash at the counter. The
// newest is the one that matters, and the older rows stay for the audit trail.
func (s *servicePayment) latestPayment(
	ctx context.Context,
	orderID int32,
) (*models.Payment, *response.ApplicationError) {
	rows, err := s.Access.Repositories.Payment.ListByOrder(ctx, orderID)
	if err != nil {
		s.Access.Logger.With(ctx).Errorf("[latestPayment] order %d: %+v", orderID, err)
		return nil, response.ErrPaymentNotFound
	}
	if len(rows) == 0 {
		return nil, response.ErrPaymentNotFound
	}

	// Prefer a settled row if one exists, so a later abandoned attempt cannot make a paid
	// order look unpaid.
	latest := rows[0]
	for _, row := range rows {
		if row.Status == models.PaymentStatusPaid {
			return row, nil
		}
		if row.CreatedAt.After(latest.CreatedAt) {
			latest = row
		}
	}
	return latest, nil
}
