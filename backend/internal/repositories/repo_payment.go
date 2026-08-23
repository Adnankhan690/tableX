package repositories

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tablex/internal/models"
)

// repositoryPayment is the data access for payments and the webhook idempotency ledger
// (DECISIONS.md D2).
//
// Two things here are load-bearing rather than routine: RecordWebhookEvent, which is the
// entire defence against a redelivered webhook settling an order twice, and LockForUpdate,
// which is what stops a gateway callback and a staff member tapping "Mark paid" from both
// settling the same payment.
type repositoryPayment struct {
	*RepositoryAccess
}

// NewRepositoryPayment returns the payment repository bound to the shared access.
func NewRepositoryPayment(access *RepositoryAccess) RepositoryPaymentMethods {
	return &repositoryPayment{RepositoryAccess: access}
}

// savepointWebhookEvent fences the ledger insert. See createIgnoringDuplicate.
const savepointWebhookEvent = "sp_webhook_event"

// Create inserts a payment attempt.
func (a *repositoryPayment) Create(ctx context.Context, tx *gorm.DB, payment *models.Payment) error {
	log := a.Logger.With(ctx)

	if err := a.conn(tx).WithContext(ctx).Create(payment).Error; err != nil {
		return fmt.Errorf("create payment uid=%s order=%d: %w", payment.UID, payment.OrderID, err)
	}

	// Amount stays in paise in the log too (DECISIONS.md D7): a log line is the artefact a
	// dispute is reconstructed from, and a formatted rupee figure there invites someone to
	// re-derive minor units from it and round.
	log.Infof("[Create] payment id=%d uid=%s order=%d provider=%s amount_minor=%d reference=%s",
		payment.ID, payment.UID, payment.OrderID, payment.Provider, payment.AmountMinor, payment.Reference)
	return nil
}

// GetByID reads one payment by primary key within a restaurant.
func (a *repositoryPayment) GetByID(ctx context.Context, restaurantID, id int32) (*models.Payment, error) {
	payment := &models.Payment{}
	if err := a.Db.WithContext(ctx).
		Where(whereRestaurantAndID, restaurantID, id).
		Take(payment).Error; err != nil {
		return nil, fmt.Errorf("get payment restaurant=%d id=%d: %w", restaurantID, id, err)
	}
	return payment, nil
}

// GetByUID reads one payment by its public identifier within a restaurant.
func (a *repositoryPayment) GetByUID(ctx context.Context, restaurantID int32, uid string) (*models.Payment, error) {
	payment := &models.Payment{}
	if err := a.Db.WithContext(ctx).
		Where(whereRestaurantAndUID, restaurantID, uid).
		Take(payment).Error; err != nil {
		return nil, fmt.Errorf("get payment restaurant=%d uid=%s: %w", restaurantID, uid, err)
	}
	return payment, nil
}

// GetByReference resolves a provider callback back to our payment row.
//
// Not restaurant-scoped, and it cannot be: a webhook arrives from the gateway with no
// tenant context at all, which is exactly why reference carries a unique index across the
// whole table (idx_payment_reference) instead of being unique per restaurant. The row it
// returns is what tells the caller which restaurant this money belongs to.
func (a *repositoryPayment) GetByReference(ctx context.Context, tx *gorm.DB, reference string) (*models.Payment, error) {
	payment := &models.Payment{}
	if err := a.conn(tx).WithContext(ctx).
		Where("reference = ?", reference).
		Take(payment).Error; err != nil {
		return nil, fmt.Errorf("get payment reference=%s: %w", reference, err)
	}
	return payment, nil
}

// LockForUpdate re-reads a payment inside a transaction, holding a row lock under Postgres.
//
// The race this settles is a webhook and a human arriving together: the gateway confirms a
// static-UPI transfer in the same second a staff member taps "Mark paid". Both would read
// status "pending", both would write "paid", and both would fire the completion side
// effects -- two realtime completions, two audit entries, and on a refund path two
// refunds. Under the lock the second caller waits, re-reads "paid", and does nothing.
func (a *repositoryPayment) LockForUpdate(ctx context.Context, tx *gorm.DB, id int32) (*models.Payment, error) {
	log := a.Logger.With(ctx)

	q := a.conn(tx).WithContext(ctx)
	if a.Db.IsPostgres() {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	// SQLite has no row-level locking syntax, so this degrades to a plain read under the
	// test driver. Deliberate: emulating it would hide the fact that the guarantee only
	// exists on Postgres, which is where the concurrency tests therefore run.

	payment := &models.Payment{}
	if err := q.Where(whereID, id).Take(payment).Error; err != nil {
		return nil, fmt.Errorf("lock payment id=%d: %w", id, err)
	}

	log.Debugf("[LockForUpdate] payment id=%d status=%s order=%d", payment.ID, payment.Status, payment.OrderID)
	return payment, nil
}

// ListByOrder returns every attempt against an order, oldest first.
//
// All of them, not just the successful one: a diner who failed twice before paying leaves
// three rows, and staff answering "did this card go through" need the sequence.
func (a *repositoryPayment) ListByOrder(ctx context.Context, orderID int32) ([]*models.Payment, error) {
	rows := make([]*models.Payment, 0, 2)
	if err := a.Db.WithContext(ctx).
		Where("order_id = ?", orderID).
		Order("created_at ASC, id ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list payments order=%d: %w", orderID, err)
	}
	return rows, nil
}

// UpdateFields applies a partial update by primary key.
//
// A map rather than a struct: settling a payment writes status and paid_at, and clearing a
// stale failed_at back to NULL has to be expressible -- GORM would drop both zero values
// from a struct update.
func (a *repositoryPayment) UpdateFields(ctx context.Context, tx *gorm.DB, id int32, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}

	res := a.conn(tx).WithContext(ctx).Model(&models.Payment{}).Where(whereID, id).Updates(fields)
	if res.Error != nil {
		return fmt.Errorf("update payment id=%d: %w", id, res.Error)
	}
	if res.RowsAffected == 0 {
		// The caller has already read this row, usually under the lock above, so zero rows
		// means it is gone. Reported rather than swallowed: silently succeeding here would
		// let a webhook handler report a settlement that was never written.
		return fmt.Errorf("update payment id=%d: %w", id, gorm.ErrRecordNotFound)
	}
	return nil
}

// RecordWebhookEvent inserts into the idempotency ledger, reporting false when this event
// has already been recorded (DECISIONS.md D2).
//
// The insert IS the check. A SELECT-then-INSERT would be racy in exactly the case that
// matters: gateways retry aggressively, so the same event id can land on two workers
// within milliseconds, and both would find nothing, both would decide "new event", and
// both would settle the order -- the second one against a payment the first has already
// marked paid. The unique (provider, event_id) index is the only thing that serialises the
// two, so the write is what we ask, and a rejection is the answer "someone else already
// has this".
//
// The caller must treat false as "stop, and return success to the gateway". Returning an
// error instead would make the gateway retry forever.
func (a *repositoryPayment) RecordWebhookEvent(
	ctx context.Context, tx *gorm.DB, event *models.PaymentWebhookEvent,
) (bool, error) {
	log := a.Logger.With(ctx)

	duplicate, err := createIgnoringDuplicate(ctx, a.conn(tx), a.savepointHandle(tx), savepointWebhookEvent, event)
	if err != nil {
		return false, fmt.Errorf("record webhook event provider=%s event_id=%s: %w",
			event.Provider, event.EventID, err)
	}
	if duplicate {
		log.Infof("[RecordWebhookEvent] duplicate delivery ignored provider=%s event_id=%s",
			event.Provider, event.EventID)
		return false, nil
	}

	log.Infof("[RecordWebhookEvent] recorded id=%d provider=%s event_id=%s type=%s signature_ok=%t",
		event.ID, event.Provider, event.EventID, event.EventType, event.SignatureOK)
	return true, nil
}

// MarkWebhookProcessed closes out a ledger row.
//
// errMsg is written even when empty, so a retry that finally succeeds clears the previous
// attempt's message. Leaving a stale error next to a completed processed_at is how an
// operator concludes that a settled payment failed.
func (a *repositoryPayment) MarkWebhookProcessed(
	ctx context.Context, tx *gorm.DB, id int64, at time.Time, errMsg string,
) error {
	log := a.Logger.With(ctx)

	res := a.conn(tx).WithContext(ctx).Model(&models.PaymentWebhookEvent{}).
		Where(whereID, id).
		Updates(map[string]any{"processed_at": at, "error": errMsg})
	if res.Error != nil {
		return fmt.Errorf("mark webhook event processed id=%d: %w", id, res.Error)
	}
	if res.RowsAffected == 0 {
		return fmt.Errorf("mark webhook event processed id=%d: %w", id, gorm.ErrRecordNotFound)
	}

	if errMsg != "" {
		log.Warnf("[MarkWebhookProcessed] event id=%d processed with error: %s", id, errMsg)
	}
	return nil
}

// savepointHandle returns the transaction to fence a duplicate-tolerant insert inside, or
// nil when no fence is needed. See createIgnoringDuplicate.
func (a *repositoryPayment) savepointHandle(tx *gorm.DB) *gorm.DB {
	if tx != nil && a.Db.IsPostgres() {
		return tx
	}
	return nil
}

// createIgnoringDuplicate inserts value and reports duplicate=true when a unique index
// rejected it, instead of returning that rejection as an error.
//
// sp is the transaction to fence the insert inside, or nil for no fence. The fence is not
// optional under Postgres: any failed statement aborts the entire transaction (SQLSTATE
// 25P02), so the unique violation we are deliberately provoking would take the caller's
// whole transaction with it -- including the COMMIT -- and the answer "already handled"
// could never be acted on. A SAVEPOINT scopes the failure to this one statement. SQLite has
// no such behaviour, and its driver support for savepoints is not something to depend on
// here, so callers pass nil for it (see savepointHandle).
//
// Shared by the webhook ledger above and the order counter in repo_order.go: both provoke a
// unique violation on purpose and both need the transaction to survive it.
func createIgnoringDuplicate(ctx context.Context, conn *gorm.DB, sp *gorm.DB, name string, value any) (bool, error) {
	if sp != nil {
		if err := sp.SavePoint(name).Error; err != nil {
			return false, fmt.Errorf("savepoint %s: %w", name, err)
		}
	}

	err := conn.WithContext(ctx).Create(value).Error
	if err == nil {
		return false, nil
	}
	if !isDuplicateKeyErr(err) {
		return false, err
	}

	if sp != nil {
		if rbErr := sp.RollbackTo(name).Error; rbErr != nil {
			// The transaction is now unusable, and saying so is better than returning
			// "duplicate" and letting the caller carry on inside a dead transaction.
			return false, fmt.Errorf("rollback to savepoint %s: %w", name, rbErr)
		}
	}
	return true, nil
}

// isDuplicateKeyErr reports whether err is a unique-constraint violation.
//
// Both checks are needed, in this order. GORM only translates driver errors into
// gorm.ErrDuplicatedKey when the connection is opened with TranslateError, which db.Open
// does not set -- so errors.Is alone would never match today, every redelivered webhook
// would look new, and the idempotency guard would be silently absent. The string check is
// therefore the one that actually fires: pgx reports "duplicate key value violates unique
// constraint", SQLite reports "UNIQUE constraint failed". Keeping the typed check first
// means switching TranslateError on later is a no-op rather than a behaviour change.
//
// Matching on message text is genuinely fragile, which is the argument for enabling
// TranslateError in db.Open -- flagged, not worked around here, because that file is frozen.
func isDuplicateKeyErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}

	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "unique violation")
}
