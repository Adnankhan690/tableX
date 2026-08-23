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

// repositoryOrder is the data access for orders, their lines, and the transition log.
//
// Two methods here carry a correctness guarantee rather than just a query: LockForUpdate
// (DECISIONS.md D1, D6) and NextOrderNumber (DECISIONS.md D9). Both are only correct
// inside a transaction, and both are commented at length because the failures they prevent
// appear exclusively under concurrent dinner-service load -- never in a single-user manual
// test, and never under SQLite.
type repositoryOrder struct {
	*RepositoryAccess
}

// NewRepositoryOrder returns the order repository bound to the shared access.
func NewRepositoryOrder(access *RepositoryAccess) RepositoryOrderMethods {
	return &repositoryOrder{RepositoryAccess: access}
}

// savepointOrderCounter fences the day's first counter insert. See NextOrderNumber.
const savepointOrderCounter = "sp_order_counter"

// Status groupings used by the aggregate. Named so the dashboard's definition of "live"
// cannot drift from the one the kitchen board filters on.
var (
	// orderStatusesVoided are the orders that never owe money and never produced food.
	orderStatusesVoided = []models.OrderStatus{models.OrderStatusCancelled, models.OrderStatusRejected}
	// orderStatusesClosed are all terminal states -- voided plus completed.
	orderStatusesClosed = []models.OrderStatus{
		models.OrderStatusCompleted, models.OrderStatusCancelled, models.OrderStatusRejected,
	}
)

// orderStatsSelect is the whole dashboard in one pass over one restaurant's day.
//
// Conditional SUMs rather than six separate COUNT queries: the six figures are shown side
// by side, so they must describe the same instant. Six round trips would let an order
// placed between them appear in one tile and not another, and a dashboard whose numbers do
// not add up is a support ticket.
//
// COALESCE on every SUM because SUM over zero rows is NULL, and a restaurant with no
// orders yet must read as 0 rather than failing to scan.
const orderStatsSelect = `
	COUNT(*) AS orders_placed,
	COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS orders_completed,
	COALESCE(SUM(CASE WHEN status IN (?) THEN 1 ELSE 0 END), 0) AS orders_cancelled,
	COALESCE(SUM(CASE WHEN status NOT IN (?) THEN 1 ELSE 0 END), 0) AS orders_live,
	COALESCE(SUM(CASE WHEN payment_status = ? THEN total_minor ELSE 0 END), 0) AS revenue_minor,
	COALESCE(SUM(CASE WHEN payment_status = ? AND status NOT IN (?) THEN total_minor ELSE 0 END), 0) AS unpaid_minor`

// orderStatsAggregate receives orderStatsSelect. Amounts stay int64 paise all the way to
// the response (DECISIONS.md D7).
type orderStatsAggregate struct {
	OrdersPlaced    int64
	OrdersCompleted int64
	OrdersCancelled int64
	OrdersLive      int64
	RevenueMinor    int64
	UnpaidMinor     int64
}

// orderTimingRow is the three-column projection the average timings are computed from.
type orderTimingRow struct {
	PlacedAt    time.Time
	AcceptedAt  *time.Time
	CompletedAt *time.Time
}

// Create inserts the order and, in the same batch, its lines.
//
// The lines travel with the parent rather than in a follow-up loop: GORM writes them in
// one statement batch with the generated order id already back-filled, so there is no
// window -- even inside the transaction -- where an order exists with no food on it.
func (a *repositoryOrder) Create(ctx context.Context, tx *gorm.DB, order *models.Order) error {
	log := a.Logger.With(ctx)

	if err := a.conn(tx).WithContext(ctx).Create(order).Error; err != nil {
		return fmt.Errorf("create order uid=%s: %w", order.UID, err)
	}

	log.Infof("[Create] order id=%d uid=%s number=%s items=%d total_minor=%d",
		order.ID, order.UID, order.OrderNumber, len(order.Items), order.TotalMinor)
	return nil
}

// GetByID reads one order by primary key within a restaurant.
//
// Take rather than First throughout this file: every predicate here is backed by a unique
// index, so First's implicit ORDER BY id would be sort work on a single row.
func (a *repositoryOrder) GetByID(ctx context.Context, restaurantID, id int32) (*models.Order, error) {
	order := &models.Order{}
	if err := a.Db.WithContext(ctx).
		Where(whereRestaurantAndID, restaurantID, id).
		Take(order).Error; err != nil {
		return nil, fmt.Errorf("get order restaurant=%d id=%d: %w", restaurantID, id, err)
	}
	return order, nil
}

// GetByUID reads one order with everything a full view renders.
func (a *repositoryOrder) GetByUID(ctx context.Context, restaurantID int32, uid string) (*models.Order, error) {
	order := &models.Order{}
	if err := withOrderDetail(a.Db.WithContext(ctx)).
		Where(whereRestaurantAndUID, restaurantID, uid).
		Take(order).Error; err != nil {
		return nil, fmt.Errorf("get order restaurant=%d uid=%s: %w", restaurantID, uid, err)
	}
	return order, nil
}

// GetByUIDAnyRestaurant reads one order with no tenant predicate at all.
//
// This is deliberately the single order read that is not scoped by restaurant: the diner's
// tracking screen presents a guest token, which identifies a session rather than a tenant
// (DECISIONS.md D5). The uid is globally unique, so the row is unambiguous -- but the
// caller MUST confirm the session owns this order before returning it, because otherwise
// one leaked uid reads another table's bill.
func (a *repositoryOrder) GetByUIDAnyRestaurant(ctx context.Context, uid string) (*models.Order, error) {
	order := &models.Order{}
	if err := withOrderDetail(a.Db.WithContext(ctx)).
		Where(whereUID, uid).
		Take(order).Error; err != nil {
		return nil, fmt.Errorf("get order uid=%s: %w", uid, err)
	}
	return order, nil
}

// GetByIdempotencyKey resolves a retried checkout to the order it already created
// (DECISIONS.md D12).
func (a *repositoryOrder) GetByIdempotencyKey(
	ctx context.Context, tx *gorm.DB, restaurantID int32, key string,
) (*models.Order, error) {
	// No key is not a lookup. idempotency_key is NULL on nearly every row and the partial
	// unique index does not cover those, so querying for an empty key would be an
	// unindexed scan whose only possible answer is "nothing".
	if key == "" {
		return nil, fmt.Errorf("get order by idempotency key: %w", gorm.ErrRecordNotFound)
	}

	order := &models.Order{}
	if err := withOrderDetail(a.conn(tx).WithContext(ctx)).
		Where("restaurant_id = ? AND idempotency_key = ?", restaurantID, key).
		Take(order).Error; err != nil {
		return nil, fmt.Errorf("get order restaurant=%d idempotency_key=%s: %w", restaurantID, key, err)
	}
	return order, nil
}

// LockForUpdate re-reads an order inside a transaction, holding a row lock under Postgres.
//
// This is the concurrency primitive the whole product rests on (DECISIONS.md D1, D6). Two
// staff phones tapping Accept, or a diner cancelling in the same instant staff accepts,
// both arrive here: the first transaction holds the row, the second blocks until it
// commits and then re-reads a status its transition is no longer legal from, so exactly
// one wins and the loser gets a 409. Without the lock both callers read "placed", both
// validate, and both write -- and the kitchen has an order that was simultaneously
// accepted and cancelled.
//
// The lines come along because the caller may need to recompute totals inside this
// transaction, and ListItems takes no tx: reading them through it would use a pool
// connection outside the transaction and miss anything this transaction has already
// written.
func (a *repositoryOrder) LockForUpdate(
	ctx context.Context, tx *gorm.DB, restaurantID int32, uid string,
) (*models.Order, error) {
	log := a.Logger.With(ctx)

	q := a.conn(tx).WithContext(ctx)
	if a.Db.IsPostgres() {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	// SQLite has no row-level locking syntax, so under the test driver this degrades to a
	// plain read. That is a deliberate fall-through rather than an emulation: nothing in
	// SQLite could reproduce the semantics, so the race tests run against Postgres and a
	// green SQLite suite must not be read as evidence that the lock works.

	order := &models.Order{}
	if err := q.Preload("Items", orderItemsInInsertOrder).
		Where(whereRestaurantAndUID, restaurantID, uid).
		Take(order).Error; err != nil {
		return nil, fmt.Errorf("lock order restaurant=%d uid=%s: %w", restaurantID, uid, err)
	}

	log.Debugf("[LockForUpdate] order uid=%s status=%s payment_status=%s", uid, order.Status, order.PaymentStatus)
	return order, nil
}

// List returns one page of the admin queue plus the unpaginated total.
func (a *repositoryOrder) List(ctx context.Context, filter OrderListFilter) ([]*models.Order, int64, error) {
	scope := orderListScope(filter)

	// The count and the page share one scope function rather than two copies of the same
	// predicate. A duplicated WHERE is how a list starts disagreeing with its own "1-20 of
	// 47" the first time a filter is added to only one of them.
	var total int64
	if err := a.Db.WithContext(ctx).Model(&models.Order{}).Scopes(scope).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count orders restaurant=%d: %w", filter.RestaurantID, err)
	}
	if total == 0 {
		// Empty slice, not nil: this marshals as [] rather than null, which the admin table
		// can render without a special case.
		return []*models.Order{}, 0, nil
	}

	q := a.Db.WithContext(ctx).Model(&models.Order{}).Scopes(scope).
		Preload("Items", orderItemsInInsertOrder).
		Preload("Table").
		// Newest first, then id as a tiebreak: two orders can share a placed_at to the
		// microsecond, and an unstable sort makes a row appear on page one and page two.
		Order(orderByPlacedDesc).
		Order("id DESC")

	// A zero limit means "no page". Pagination defaults belong to the service; inventing a
	// second default here is how two layers end up disagreeing about page size.
	if filter.Limit > 0 {
		q = q.Limit(filter.Limit)
	}
	if filter.Offset > 0 {
		q = q.Offset(filter.Offset)
	}

	rows := make([]*models.Order, 0, filter.Limit)
	if err := q.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list orders restaurant=%d: %w", filter.RestaurantID, err)
	}
	return rows, total, nil
}

// ListByGuestSession is "your orders at this table this sitting" (DECISIONS.md D5).
func (a *repositoryOrder) ListByGuestSession(ctx context.Context, sessionID int32) ([]*models.Order, error) {
	rows := make([]*models.Order, 0, 4)
	if err := a.Db.WithContext(ctx).
		Preload("Items", orderItemsInInsertOrder).
		Preload("Table").
		Where("guest_session_id = ?", sessionID).
		Order(orderByPlacedDesc).
		Order("id DESC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list orders for guest session=%d: %w", sessionID, err)
	}
	return rows, nil
}

// UpdateFields applies a partial update by primary key.
//
// A map rather than a struct so that writing a zero -- discount_minor back to 0, a cleared
// cancel_reason -- is expressible. GORM ignores zero-valued struct fields, which would
// make those two updates silently no-ops.
func (a *repositoryOrder) UpdateFields(ctx context.Context, tx *gorm.DB, id int32, fields map[string]any) error {
	if len(fields) == 0 {
		// Nothing to change is not an error, but it must not reach the database: an UPDATE
		// with an empty SET is a syntax error, and GORM rejects the empty map outright.
		return nil
	}

	res := a.conn(tx).WithContext(ctx).Model(&models.Order{}).Where(whereID, id).Updates(fields)
	if res.Error != nil {
		return fmt.Errorf("update order id=%d: %w", id, res.Error)
	}
	if res.RowsAffected == 0 {
		// Every caller here has already read (usually locked) this row, so zero rows means
		// it vanished underneath them. Reported as not-found rather than as success,
		// because a status transition that wrote nothing must not be published as applied.
		return fmt.Errorf("update order id=%d: %w", id, gorm.ErrRecordNotFound)
	}
	return nil
}

// AppendStatusEvent writes one row to the append-only transition log.
func (a *repositoryOrder) AppendStatusEvent(ctx context.Context, tx *gorm.DB, event *models.OrderStatusEvent) error {
	log := a.Logger.With(ctx)

	if err := a.conn(tx).WithContext(ctx).Create(event).Error; err != nil {
		return fmt.Errorf("append status event order=%d to=%s: %w", event.OrderID, event.ToStatus, err)
	}

	log.Infof("[AppendStatusEvent] order_id=%d %s -> %s actor=%s/%s",
		event.OrderID, event.FromStatus, event.ToStatus, event.ActorType, event.ActorID)
	return nil
}

// ListStatusEvents returns the timeline oldest-first, which is the order it is read in.
func (a *repositoryOrder) ListStatusEvents(ctx context.Context, orderID int32) ([]*models.OrderStatusEvent, error) {
	rows := make([]*models.OrderStatusEvent, 0, 6)
	if err := a.Db.WithContext(ctx).
		Where("order_id = ?", orderID).
		// id breaks the tie: two transitions in the same microsecond are rare but they must
		// still render in the sequence they were written, not an arbitrary one.
		Order("created_at ASC, id ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list status events order=%d: %w", orderID, err)
	}
	return rows, nil
}

// GetItemByUID reads one line, scoped to its order.
//
// The order id is part of the predicate even though uid is globally unique: it makes
// "cancel item X on order Y" fail when X belongs to some other order, rather than
// cancelling a line on a table nobody asked about.
func (a *repositoryOrder) GetItemByUID(
	ctx context.Context, tx *gorm.DB, orderID int32, uid string,
) (*models.OrderItem, error) {
	item := &models.OrderItem{}
	if err := a.conn(tx).WithContext(ctx).
		Where("order_id = ? AND uid = ?", orderID, uid).
		Take(item).Error; err != nil {
		return nil, fmt.Errorf("get order item order=%d uid=%s: %w", orderID, uid, err)
	}
	return item, nil
}

// UpdateItemFields applies a partial update to one line by primary key.
func (a *repositoryOrder) UpdateItemFields(ctx context.Context, tx *gorm.DB, id int32, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}

	res := a.conn(tx).WithContext(ctx).Model(&models.OrderItem{}).Where(whereID, id).Updates(fields)
	if res.Error != nil {
		return fmt.Errorf("update order item id=%d: %w", id, res.Error)
	}
	if res.RowsAffected == 0 {
		return fmt.Errorf("update order item id=%d: %w", id, gorm.ErrRecordNotFound)
	}
	return nil
}

// ListItems returns an order's lines in insertion order.
func (a *repositoryOrder) ListItems(ctx context.Context, orderID int32) ([]*models.OrderItem, error) {
	rows := make([]*models.OrderItem, 0, 8)
	if err := a.Db.WithContext(ctx).
		Where("order_id = ?", orderID).
		Order("id ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list order items order=%d: %w", orderID, err)
	}
	return rows, nil
}

// NextOrderNumber allocates the next daily number for a restaurant (DECISIONS.md D9).
//
// Must be called inside a transaction: the guarantee is that the counter row stays locked
// from the read until the enclosing transaction commits, and outside a transaction the
// lock is released the instant this function returns.
//
// Why a locked counter row and not SELECT COUNT(*) + 1. Two diners checking out in the
// same second both count the same N committed orders, both compute N+1, and both insert
// it -- which either collides on idx_orders_number and fails one diner's checkout, or, if
// that index were ever dropped, hands two different tables the same number to shout across
// the kitchen. Counting is a read of a value that another uncommitted transaction is
// already changing; SELECT ... FOR UPDATE on one row makes the second caller wait for the
// first to commit and then read the number it actually allocated. The lock, not the
// arithmetic, is what makes the number unique.
func (a *repositoryOrder) NextOrderNumber(
	ctx context.Context, tx *gorm.DB, restaurantID int32, businessDate time.Time,
) (int, error) {
	log := a.Logger.With(ctx)

	// The caller has already converted to the restaurant's own timezone (a 1am order belongs
	// to the previous evening's service). Stripping the clock here means two callers who
	// disagree about the time of day still land on the same counter row instead of opening a
	// second one for the same service date.
	date := time.Date(businessDate.Year(), businessDate.Month(), businessDate.Day(), 0, 0, 0, 0, time.UTC)

	counter, err := a.lockOrderCounter(ctx, tx, restaurantID, date)
	switch {
	case err == nil:
		return a.bumpOrderCounter(ctx, tx, counter)
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return 0, err
	}

	// First order of the service date. Insert at 1 rather than 0-then-increment so the row
	// is never briefly visible in a state that would hand the next caller the same number.
	row := &models.OrderCounter{RestaurantID: restaurantID, BusinessDate: date, LastNumber: 1}
	duplicate, err := createIgnoringDuplicate(ctx, a.conn(tx), a.savepointHandle(tx), savepointOrderCounter, row)
	if err != nil {
		return 0, fmt.Errorf("create order counter restaurant=%d date=%s: %w",
			restaurantID, date.Format(time.DateOnly), err)
	}
	if !duplicate {
		log.Infof("[NextOrderNumber] opened counter restaurant=%d date=%s number=1",
			restaurantID, date.Format(time.DateOnly))
		return row.LastNumber, nil
	}

	// Lost the insert race: two transactions both found no row, and the other committed
	// first. Its row is committed by definition -- our INSERT blocked on the unique index
	// until it was -- and under READ COMMITTED, which is what db.Open leaves in place, the
	// next statement takes a fresh snapshot and sees it. So exactly one retry resolves
	// this: there is no second race to lose, because from here on the row exists.
	counter, err = a.lockOrderCounter(ctx, tx, restaurantID, date)
	if err != nil {
		return 0, fmt.Errorf("re-read order counter restaurant=%d date=%s after insert race: %w",
			restaurantID, date.Format(time.DateOnly), err)
	}
	return a.bumpOrderCounter(ctx, tx, counter)
}

// lockOrderCounter reads the counter row for one service date, holding it under Postgres.
// The gorm.ErrRecordNotFound is passed through unwrapped-in-message so the caller can
// branch on it.
func (a *repositoryOrder) lockOrderCounter(
	ctx context.Context, tx *gorm.DB, restaurantID int32, date time.Time,
) (*models.OrderCounter, error) {
	q := a.conn(tx).WithContext(ctx)
	if a.Db.IsPostgres() {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	// As in LockForUpdate: SQLite has no FOR UPDATE, so concurrent number allocation is not
	// serialised there. It is not a problem in practice only because the test suite drives
	// SQLite single-threaded -- it is not evidence the allocation is safe.

	counter := &models.OrderCounter{}
	if err := q.Where("restaurant_id = ? AND business_date = ?", restaurantID, date).
		Take(counter).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		return nil, fmt.Errorf("lock order counter restaurant=%d date=%s: %w",
			restaurantID, date.Format(time.DateOnly), err)
	}
	return counter, nil
}

// bumpOrderCounter writes the incremented value back and returns it.
//
// Read-then-write is safe here only because the caller holds the row lock. The new value is
// written literally rather than as last_number + 1 because the number has to be returned,
// and re-reading it after an expression update would be a second round trip for a value we
// already know.
func (a *repositoryOrder) bumpOrderCounter(
	ctx context.Context, tx *gorm.DB, counter *models.OrderCounter,
) (int, error) {
	next := counter.LastNumber + 1
	if err := a.conn(tx).WithContext(ctx).Model(&models.OrderCounter{}).
		Where(whereID, counter.ID).
		Updates(map[string]any{"last_number": next}).Error; err != nil {
		return 0, fmt.Errorf("increment order counter id=%d: %w", counter.ID, err)
	}
	return next, nil
}

// savepointHandle returns the transaction to fence a duplicate-tolerant insert inside, or
// nil when no fence is needed. See createIgnoringDuplicate for why Postgres needs one.
func (a *repositoryOrder) savepointHandle(tx *gorm.DB) *gorm.DB {
	if tx != nil && a.Db.IsPostgres() {
		return tx
	}
	return nil
}

// Stats aggregates one restaurant's orders over [from, to).
//
// Half-open on purpose: consecutive ranges tile exactly, so an order placed on the
// midnight boundary lands in one day's dashboard rather than in both or in neither.
func (a *repositoryOrder) Stats(ctx context.Context, restaurantID int32, from, to time.Time) (*OrderStats, error) {
	log := a.Logger.With(ctx)

	inRange := func(q *gorm.DB) *gorm.DB {
		return q.Where(whereRestaurant, restaurantID).Where("placed_at >= ? AND placed_at < ?", from, to)
	}

	agg := orderStatsAggregate{}
	if err := inRange(a.Db.WithContext(ctx).Model(&models.Order{})).
		Select(orderStatsSelect,
			models.OrderStatusCompleted,
			orderStatusesVoided,
			orderStatusesClosed,
			models.PaymentStatusPaid,
			// Unpaid is what is still owed: pending payment on an order that was not voided.
			// A completed-but-unpaid counter order is exactly the row staff are looking for
			// here, so completed is deliberately included and only cancelled and rejected
			// are excluded.
			models.PaymentStatusPending, orderStatusesVoided,
		).
		Scan(&agg).Error; err != nil {
		return nil, fmt.Errorf("aggregate order stats restaurant=%d: %w", restaurantID, err)
	}

	// The two averages are computed in Go from a three-column projection rather than in SQL.
	//
	// Second-level date arithmetic has no portable spelling: Postgres wants
	// EXTRACT(EPOCH FROM accepted_at - placed_at), SQLite has no interval type at all and
	// needs (julianday(a) - julianday(b)) * 86400. Branching on the driver would mean the
	// dashboard's headline metric is produced by two different expressions, only one of
	// which the test suite ever runs -- so the arithmetic lives here, where both drivers
	// give the same answer and the rounding is testable without a database. The projection
	// is bounded by one restaurant's orders in one range, and skips rows that reached
	// neither timestamp, so the transfer is a few hundred rows on a busy night.
	var timings []orderTimingRow
	if err := inRange(a.Db.WithContext(ctx).Model(&models.Order{})).
		Select("placed_at, accepted_at, completed_at").
		Where("(accepted_at IS NOT NULL OR completed_at IS NOT NULL)").
		Scan(&timings).Error; err != nil {
		return nil, fmt.Errorf("project order timings restaurant=%d: %w", restaurantID, err)
	}

	var (
		acceptTotal, fulfilTotal time.Duration
		acceptCount, fulfilCount int64
	)
	for i := range timings {
		row := timings[i]
		// A negative interval means the row's timestamps disagree -- clock skew between
		// application instances, or a backfill. Dropping it keeps one bad row from dragging
		// the mean below zero, which would render as a nonsense metric nobody can explain.
		if row.AcceptedAt != nil {
			if d := row.AcceptedAt.Sub(row.PlacedAt); d >= 0 {
				acceptTotal += d
				acceptCount++
			}
		}
		if row.CompletedAt != nil {
			if d := row.CompletedAt.Sub(row.PlacedAt); d >= 0 {
				fulfilTotal += d
				fulfilCount++
			}
		}
	}

	stats := &OrderStats{
		OrdersPlaced:    agg.OrdersPlaced,
		OrdersCompleted: agg.OrdersCompleted,
		OrdersCancelled: agg.OrdersCancelled,
		OrdersLive:      agg.OrdersLive,
		RevenueMinor:    agg.RevenueMinor,
		UnpaidMinor:     agg.UnpaidMinor,
		AvgAcceptSecs:   meanSeconds(acceptTotal, acceptCount),
		AvgFulfilSecs:   meanSeconds(fulfilTotal, fulfilCount),
	}

	log.Debugf("[Stats] restaurant=%d placed=%d live=%d revenue_minor=%d unpaid_minor=%d measured_accepts=%d",
		restaurantID, stats.OrdersPlaced, stats.OrdersLive, stats.RevenueMinor, stats.UnpaidMinor, acceptCount)
	return stats, nil
}

// meanSeconds returns the rounded mean interval, or nil when nothing was measured.
//
// Nil rather than 0 is the whole point: zero seconds is an assertion that orders are
// accepted instantly, which is a different and much more flattering claim than "no order
// in this range was accepted". The dashboard omits the tile when this is nil.
func meanSeconds(total time.Duration, count int64) *int64 {
	if count == 0 {
		return nil
	}
	// Rounded, not truncated. Truncation biases every average downward, and it biases the
	// two metrics the restaurant is judged on in the direction that flatters them.
	mean := total / time.Duration(count)
	secs := int64((mean + time.Second/2) / time.Second)
	return &secs
}

// orderListScope turns an OrderListFilter into a reusable predicate, so the page query and
// the count query cannot drift apart.
func orderListScope(filter OrderListFilter) func(*gorm.DB) *gorm.DB {
	return func(q *gorm.DB) *gorm.DB {
		q = q.Where(whereRestaurant, filter.RestaurantID)

		if len(filter.Statuses) > 0 {
			q = q.Where("status IN ?", filter.Statuses)
		}
		if filter.TableID != nil {
			q = q.Where("table_id = ?", *filter.TableID)
		}
		if filter.PaymentStatus != nil {
			q = q.Where("payment_status = ?", *filter.PaymentStatus)
		}
		if search := strings.TrimSpace(filter.Search); search != "" {
			// LOWER on both sides because Postgres LIKE is case-sensitive, and staff type
			// "priya" looking for "Priya". The OR is parenthesised explicitly rather than
			// trusting the query builder to bracket it: an OR that escaped its group would
			// sit beside the tenant predicate as an alternative to it, and the queue would
			// list another restaurant's orders.
			pattern := "%" + strings.ToLower(search) + "%"
			q = q.Where("(LOWER(order_number) LIKE ? OR LOWER(customer_name) LIKE ?)", pattern, pattern)
		}
		if filter.From != nil {
			q = q.Where("placed_at >= ?", *filter.From)
		}
		if filter.To != nil {
			// Inclusive, unlike Stats: these two bounds come from a staff member typing a
			// date range, and a range that silently excludes its own end date reads as
			// missing orders.
			q = q.Where("placed_at <= ?", *filter.To)
		}
		return q
	}
}

// withOrderDetail preloads everything a single-order view renders: the lines, the timeline,
// and the table label.
//
// The queue deliberately does not use this -- see List, which loads lines and table but not
// timelines, because fifty orders' worth of transitions is a payload no screen reads.
func withOrderDetail(q *gorm.DB) *gorm.DB {
	return q.
		Preload("Items", orderItemsInInsertOrder).
		Preload("Events", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at ASC, id ASC")
		}).
		Preload("Table")
}

// orderItemsInInsertOrder keeps a bill's lines in the sequence they were ordered in.
// Without it the preload's row order is whatever the storage engine returns, and a diner
// comparing the tracking screen with the printed bill sees them shuffled.
func orderItemsInInsertOrder(db *gorm.DB) *gorm.DB {
	return db.Order("id ASC")
}
