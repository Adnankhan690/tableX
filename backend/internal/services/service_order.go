package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"tablex/internal/models"
	"tablex/internal/repositories"
	"tablex/internal/response"
	"tablex/internal/types"
	"tablex/internal/utils"
)

// ServiceOrder is exported, unlike its siblings, because the payment service holds a
// concrete reference to it: settling a payment must complete an order through the state
// machine and the audit log rather than writing the status column directly.
type ServiceOrder struct {
	Access *ServiceAccess
}

// NewServiceOrder builds the order service.
func NewServiceOrder(access *ServiceAccess) *ServiceOrder {
	return &ServiceOrder{Access: access}
}

// Place prices and commits an order.
//
// Everything below happens in ONE transaction: the idempotency check, the pricing read, the
// order-number allocation under a row lock, the order and item inserts, and the initial
// status event. All of it or none of it. PRD 7 makes not losing an order the core trust
// requirement of this product, and a diner charged for an order the kitchen never received
// is the failure it cannot have.
//
// The payment intent is deliberately NOT created here. Doing so would make the order service
// depend on the payment service while the payment service already depends on this one. The
// controller composes the two instead -- see ServicePaymentMethods.StartIntentForOrder.
func (s *ServiceOrder) Place(
	ctx context.Context,
	guest *GuestPrincipal,
	req *types.RequestPlaceOrder,
	idempotencyKey string,
) (*types.ResponsePlaceOrder, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	method := models.PaymentMethod(req.PaymentMethod)
	if !method.Valid() {
		return nil, response.ErrPaymentMethodInvalid
	}

	lines, appErr := s.normalizeCart(req.Items)
	if appErr != nil {
		return nil, appErr
	}

	restaurant, appErr := loadActiveRestaurant(ctx, s.Access, guest.RestaurantID)
	if appErr != nil {
		return nil, appErr
	}

	// The "we are open" switch (DECISIONS.md D18). Checked HERE and not on the scan, deliberately:
	// a diner outside a closed restaurant may read the menu, and the honest place to stop them is
	// the moment they try to order rather than the moment they look. The diner app is told through
	// RestaurantSummary.accepting_orders, so it says so up front rather than letting somebody build
	// a cart and meet this at checkout.
	//
	// It is the cheapest control against an order placed from outside the restaurant entirely,
	// because at 11pm there is nobody to accept it and nobody to eat it.
	if !restaurant.Open() {
		return nil, response.ErrRestaurantClosed
	}

	var (
		order     *models.Order
		fromRetry bool
	)

	txErr := s.Access.Db.Transaction(ctx, func(tx *gorm.DB) error {
		// Checked first, inside the transaction. The failure this guards is mundane and
		// common: a diner taps "Place order" on a stalled connection and taps again. Without
		// it the kitchen gets two tickets (DECISIONS.md D12).
		if idempotencyKey != "" {
			existing, err := s.Access.Repositories.Order.GetByIdempotencyKey(
				ctx, tx, guest.RestaurantID, idempotencyKey)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("idempotency lookup: %w", err)
			}
			if existing != nil {
				order, fromRetry = existing, true
				return nil
			}
		}

		built, err := s.buildOrder(ctx, tx, guest, restaurant, req, lines, method, idempotencyKey)
		if err != nil {
			return err
		}

		if err := s.Access.Repositories.Order.Create(ctx, tx, built); err != nil {
			// Two requests carrying the same key can both pass the lookup above and both reach
			// this insert -- the lookup is a read, so it does not serialise them. The unique
			// index on (restaurant_id, idempotency_key) is what actually prevents the duplicate,
			// and losing that race means the OTHER request created the order the caller wanted.
			//
			// Returning it is the whole point of idempotency. Surfacing a 500 here would leave a
			// diner staring at an error for an order that exists and is already in the kitchen,
			// which is the exact confusion D12 sets out to remove.
			//
			// It must be THIS index though, not merely some unique index. orders carries three
			// (uid, the idempotency key, and the order number), and treating every 23505 as the
			// idempotency race sends the other two down a path that looks up a key which was
			// never the problem, finds nothing, and reports "could not read the winner" -- a log
			// line naming a race that never happened, and a generic 500 for the diner. That is
			// exactly how the daily order-number collision stayed hidden.
			if isIdempotencyDuplicate(err) {
				return errIdempotentRace
			}
			return fmt.Errorf("create order: %w", err)
		}

		// The first entry in the timeline. from_status is empty because the order came into
		// existence at 'placed' rather than transitioning into it.
		if err := s.Access.Repositories.Order.AppendStatusEvent(ctx, tx, &models.OrderStatusEvent{
			OrderID:   built.ID,
			ToStatus:  models.OrderStatusPlaced,
			ActorType: models.ActorTypeGuest,
			ActorID:   guest.SessionUID,
		}); err != nil {
			return fmt.Errorf("append placed event: %w", err)
		}

		order = built
		return nil
	})

	if txErr != nil {
		// Lost the insert race. The winner has committed by now, so a plain read outside the
		// transaction resolves the key to the order that exists.
		if errors.Is(txErr, errIdempotentRace) {
			existing, err := s.Access.Repositories.Order.GetByIdempotencyKey(
				ctx, nil, guest.RestaurantID, idempotencyKey)
			if err != nil {
				log.Errorf("[Place] lost the idempotency race but could not read the winner: %+v", err)
				return nil, response.ErrOrderCreateFailed
			}
			log.Infof("[Place] concurrent duplicate resolved to existing order %s", existing.UID)
			view := toOrderView(existing, nil, guest.TableLabel, ActorGuest)
			return &types.ResponsePlaceOrder{Order: view}, nil
		}

		// A domain error raised inside the transaction is surfaced as itself; anything else is
		// an infrastructure failure the diner cannot act on.
		var appErr *response.ApplicationError
		if errors.As(txErr, &appErr) {
			return nil, appErr
		}
		log.Errorf("[Place] transaction failed for session %s: %+v", guest.SessionUID, txErr)
		return nil, response.ErrOrderCreateFailed
	}

	if fromRetry {
		log.Infof("[Place] idempotent replay returned existing order %s", order.UID)
		view := toOrderView(order, nil, guest.TableLabel, ActorGuest)
		return &types.ResponsePlaceOrder{Order: view}, nil
	}

	log.Infof("[Place] order %s (%s) placed at table %s, total %d paise, method %s",
		order.UID, order.OrderNumber, guest.TableLabel, order.TotalMinor, order.PaymentMethod)

	// After the commit, never inside it. Publishing from inside would announce an order that a
	// rollback then discards, and the admin board would show something that does not exist
	// (DECISIONS.md D10).
	s.Access.publishOrderEvent(
		types.EventOrderPlaced, guest.RestaurantUID, order.UID,
		string(order.Status), guest.TableLabel)

	view := toOrderView(order, nil, guest.TableLabel, ActorGuest)
	return &types.ResponsePlaceOrder{Order: view}, nil
}

// errIdempotentRace signals that a concurrent request with the same idempotency key won the
// insert. A sentinel rather than an ApplicationError because it is not a failure -- it is a
// redirect to the order that already exists.
var errIdempotentRace = errors.New("services: idempotency key already used by a concurrent request")

// isDuplicateKey reports whether err is a unique-constraint violation.
//
// Checked three ways because the answer has to be right on both drivers: GORM's translated
// error is not populated unless TranslateError is enabled, and the two drivers word their
// raw messages differently.
func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "sqlstate 23505")
}

// isIdempotencyDuplicate reports whether err is a unique violation on the idempotency key
// specifically, rather than on any of the other unique indexes orders carries.
//
// Both drivers name the offending object in the message and both spell it with the same word:
// Postgres reports the index, `unique constraint "idx_orders_idempotency"`, and SQLite reports
// the columns, `orders.restaurant_id, orders.idempotency_key`. Matching the shared token is
// what keeps this correct on either.
//
// Note what this deliberately does NOT do: it never widens to "some unique index was hit".
// gorm.ErrDuplicatedKey carries no constraint name, so a translated error cannot be attributed
// and does not qualify on its own -- an unattributable duplicate is surfaced as a real error
// rather than silently assumed to be this one.
func isIdempotencyDuplicate(err error) bool {
	if !isDuplicateKey(err) {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "idempotency")
}

// cartLine is one validated, deduplicated request line.
type cartLine struct {
	MenuItemUID string
	Quantity    int
	Note        string
}

// normalizeCart validates the request and merges duplicate lines.
//
// Duplicates are merged rather than rejected: a diner tapping "+" twice on the same dish, or
// a client that appends instead of incrementing, is ordinary behaviour and should not be a
// validation error.
func (s *ServiceOrder) normalizeCart(items []types.RequestOrderItem) ([]cartLine, *response.ApplicationError) {
	if len(items) == 0 {
		return nil, response.ErrOrderEmptyCart
	}

	maxItems := s.Access.Cfg.Guest.MaxItemsPerOrder
	maxQty := s.Access.Cfg.Guest.MaxQuantityPerItem

	merged := make(map[string]*cartLine, len(items))
	order := make([]string, 0, len(items))

	for _, item := range items {
		uid := strings.TrimSpace(item.MenuItemUID)
		if uid == "" {
			return nil, response.ErrInvalidRequest.WithMessage("every cart line needs a menu item")
		}
		if item.Quantity < 1 {
			return nil, response.ErrOrderQuantityInvalid
		}

		if existing, ok := merged[uid]; ok {
			existing.Quantity += item.Quantity
			// Keep the first note rather than concatenating: two conflicting instructions on one
			// line would reach the kitchen as a single confusing string.
			if existing.Note == "" {
				existing.Note = strings.TrimSpace(item.Note)
			}
		} else {
			merged[uid] = &cartLine{
				MenuItemUID: uid,
				Quantity:    item.Quantity,
				Note:        strings.TrimSpace(item.Note),
			}
			order = append(order, uid)
		}
	}

	// Bounds are checked after merging, so a cart of fifty "+1 naan" lines is one line of
	// fifty rather than fifty lines.
	if len(order) > maxItems {
		return nil, response.ErrOrderTooManyItems
	}

	lines := make([]cartLine, 0, len(order))
	for _, uid := range order {
		line := merged[uid]
		if line.Quantity > maxQty {
			return nil, response.ErrOrderQuantityInvalid
		}
		lines = append(lines, *line)
	}
	return lines, nil
}

// buildOrder prices the cart from the live menu and assembles the order.
//
// Pricing happens here, server-side, from the current menu rows. The request DTO carries no
// amount at all: a client-supplied total would let a diner order a thali for one rupee.
func (s *ServiceOrder) buildOrder(
	ctx context.Context,
	tx *gorm.DB,
	guest *GuestPrincipal,
	restaurant *models.Restaurant,
	req *types.RequestPlaceOrder,
	lines []cartLine,
	method models.PaymentMethod,
	idempotencyKey string,
) (*models.Order, error) {
	uids := make([]string, 0, len(lines))
	for _, line := range lines {
		uids = append(uids, line.MenuItemUID)
	}

	// One query for the whole cart, inside the transaction, so every line is priced from the
	// same point in time. Per-line queries would let a price edit landing mid-checkout apply
	// to half the order.
	items, err := s.Access.Repositories.Menu.GetItemsByUIDs(ctx, tx, restaurant.ID, uids)
	if err != nil {
		return nil, fmt.Errorf("load menu items: %w", err)
	}

	byUID := make(map[string]*models.MenuItem, len(items))
	for _, item := range items {
		byUID[item.UID] = item
	}

	orderItems := make([]models.OrderItem, 0, len(lines))
	var subtotal int64

	for _, line := range lines {
		item, ok := byUID[line.MenuItemUID]
		if !ok {
			// The uid did not resolve within this restaurant. Reported as not-found rather than
			// forbidden, so a uid belonging to another tenant is indistinguishable from a
			// nonexistent one.
			return nil, response.ErrMenuItemNotFound
		}
		if !item.Orderable() {
			// Ordinary, not exceptional: the menu page may have been open for twenty minutes
			// while the kitchen ran out.
			return nil, response.ErrMenuItemUnavailable.WithMessage(
				fmt.Sprintf("%s is no longer available", item.Name))
		}

		lineTotal := item.PriceMinor * int64(line.Quantity)
		subtotal += lineTotal

		orderItems = append(orderItems, models.OrderItem{
			UID:        utils.GenerateUID(utils.UIDPrefixOrderItem),
			MenuItemID: item.ID,
			// Snapshotted, never joined live. An 8pm price rise must not rewrite a 7:45pm bill,
			// and a renamed dish must still read correctly on last month's order
			// (DECISIONS.md D8).
			NameSnapshot:   item.Name,
			UnitPriceMinor: item.PriceMinor,
			FoodType:       item.FoodType,
			Quantity:       line.Quantity,
			TotalMinor:     lineTotal,
			Note:           line.Note,
			Status:         models.OrderItemStatusActive,
		})
	}

	tax := utils.ApplyBasisPoints(subtotal, restaurant.TaxBps)
	serviceCharge := utils.ApplyBasisPoints(subtotal, restaurant.ServiceChargeBps)

	now := time.Now().UTC()
	// One business date for both the counter and the row: the number's uniqueness is scoped by
	// this value, so computing it twice would risk the row landing on a different day than the
	// counter that issued its number (a placement straddling local midnight).
	businessDate := restaurant.BusinessDate(now)
	number, err := s.Access.Repositories.Order.NextOrderNumber(
		ctx, tx, restaurant.ID, businessDate)
	if err != nil {
		return nil, fmt.Errorf("allocate order number: %w", err)
	}

	order := &models.Order{
		UID:            utils.GenerateUID(utils.UIDPrefixOrder),
		RestaurantID:   restaurant.ID,
		TableID:        guest.TableID,
		GuestSessionID: &guest.SessionID,
		OrderNumber:    formatOrderNumber(number),
		BusinessDate:   businessDate,
		Status:         models.OrderStatusPlaced,

		SubtotalMinor:      subtotal,
		TaxMinor:           tax,
		ServiceChargeMinor: serviceCharge,
		DiscountMinor:      0,
		TotalMinor:         subtotal + tax + serviceCharge,
		Currency:           restaurant.Currency,

		PaymentMethod: method,
		PaymentStatus: models.PaymentStatusPending,

		CustomerName:  strings.TrimSpace(req.CustomerName),
		CustomerPhone: strings.TrimSpace(req.CustomerPhone),
		Note:          strings.TrimSpace(req.Note),

		PlacedAt: now,
		Items:    orderItems,
	}

	if idempotencyKey != "" {
		order.IdempotencyKey = &idempotencyKey
	}

	return order, nil
}

// formatOrderNumber renders the daily counter as something a person can shout.
//
// "A-014" rather than the uid, because staff call order numbers across a kitchen and
// "ord_8f3a2b..." is unusable out loud (DECISIONS.md D9). The letter advances once the
// counter passes 999, so a very busy day stays three digits wide instead of becoming
// "A-1004".
func formatOrderNumber(n int) string {
	const perLetter = 999
	letterIndex := (n - 1) / perLetter
	within := (n-1)%perLetter + 1

	letter := 'A' + rune(letterIndex%26)
	return fmt.Sprintf("%c-%03d", letter, within)
}

// GetForGuest returns one order, verifying the session owns it.
func (s *ServiceOrder) GetForGuest(
	ctx context.Context,
	guest *GuestPrincipal,
	uid string,
) (*types.OrderView, *response.ApplicationError) {
	order, appErr := s.loadGuestOrder(ctx, guest, uid)
	if appErr != nil {
		return nil, appErr
	}

	events, err := s.Access.Repositories.Order.ListStatusEvents(ctx, order.ID)
	if err != nil {
		// The timeline is decoration on a screen whose main job is showing the current status.
		// Losing it must not fail the request the diner actually needs.
		s.Access.Logger.With(ctx).Warnf("[GetForGuest] timeline unavailable for %s: %+v", uid, err)
	}

	view := toOrderView(order, events, guest.TableLabel, ActorGuest)
	s.attachServiceReview(ctx, guest, &view)
	return &view, nil
}

// ListForGuest returns the orders placed from this session -- "your orders at this table
// this sitting" (DECISIONS.md D5). Not a cross-visit account history: that would need an
// identity, which would need a login.
func (s *ServiceOrder) ListForGuest(
	ctx context.Context,
	guest *GuestPrincipal,
) (*types.ResponseGuestOrders, *response.ApplicationError) {
	orders, err := s.Access.Repositories.Order.ListByGuestSession(ctx, guest.SessionID)
	if err != nil {
		s.Access.Logger.With(ctx).Errorf("[ListForGuest] session %s: %+v", guest.SessionUID, err)
		return nil, response.ErrOrderFetchFailed
	}

	views := make([]types.OrderView, 0, len(orders))
	for _, order := range orders {
		views = append(views, toOrderView(order, nil, guest.TableLabel, ActorGuest))
	}

	// One lookup for the whole page, not one per order. The service review is session-scoped, so
	// every order in this list carries the SAME row -- querying per order would be N copies of one
	// answer (DECISIONS.md D17).
	ptrs := make([]*types.OrderView, 0, len(views))
	for i := range views {
		ptrs = append(ptrs, &views[i])
	}
	s.attachServiceReview(ctx, guest, ptrs...)

	return &types.ResponseGuestOrders{Orders: views}, nil
}

// attachServiceReview fills in the session's own service rating on each view.
//
// Done here rather than inside toOrderView because the rating belongs to the SITTING, not to any
// order -- toOrderView takes an order and could only guess. Doing it at the two call sites that
// actually render the rating card keeps the extra query off the staff paths, which have no use
// for it.
//
// A failure is logged and swallowed. The diner's screen is about their order; losing the stars
// they already gave would be a shame, but failing the whole request over it would be worse.
func (s *ServiceOrder) attachServiceReview(
	ctx context.Context,
	guest *GuestPrincipal,
	views ...*types.OrderView,
) {
	if len(views) == 0 {
		return
	}

	review, err := s.Access.Repositories.Review.GetServiceBySession(ctx, nil, guest.SessionID)
	if err != nil {
		// Not having rated service yet is the common case, not a failure.
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			s.Access.Logger.With(ctx).Warnf(
				"[attachServiceReview] session %s: %+v", guest.SessionUID, err)
		}
		return
	}

	view := toServiceReviewView(review)
	for _, v := range views {
		v.ServiceReview = view
	}
}

// CancelByGuest withdraws an order the kitchen has not started (DECISIONS.md D6).
func (s *ServiceOrder) CancelByGuest(
	ctx context.Context,
	guest *GuestPrincipal,
	uid string,
) (*types.OrderView, *response.ApplicationError) {
	// Ownership is verified before the transaction so an unauthorised caller never acquires a
	// row lock on someone else's order.
	if _, appErr := s.loadGuestOrder(ctx, guest, uid); appErr != nil {
		return nil, appErr
	}

	return s.applyTransition(ctx, transitionInput{
		RestaurantID:  guest.RestaurantID,
		RestaurantUID: guest.RestaurantUID,
		OrderUID:      uid,
		Target:        models.OrderStatusCancelled,
		Actor:         ActorGuest,
		ActorID:       guest.SessionUID,
		TableLabel:    guest.TableLabel,
		// A diner changing their mind owes no explanation, and demanding one would be a
		// pointless obstacle on a phone.
		Reason: "",
		// The generic illegal-transition message is unhelpful here. "The kitchen has already
		// started this order" tells the diner what happened and what to do instead.
		RefusalOverride: response.ErrOrderCancelTooLate,
	})
}

// loadGuestOrder fetches an order and checks the session owns it.
func (s *ServiceOrder) loadGuestOrder(
	ctx context.Context,
	guest *GuestPrincipal,
	uid string,
) (*models.Order, *response.ApplicationError) {
	order, err := s.Access.Repositories.Order.GetByUIDAnyRestaurant(ctx, uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrOrderNotFound
		}
		s.Access.Logger.With(ctx).Errorf("[loadGuestOrder] %s: %+v", uid, err)
		return nil, response.ErrOrderFetchFailed
	}

	// A 404, not a 403. Confirming that an order exists but belongs to someone else would let
	// a caller enumerate other tables' orders by uid.
	if order.GuestSessionID == nil || *order.GuestSessionID != guest.SessionID {
		return nil, response.ErrOrderNotYours
	}
	return order, nil
}

// ListForStaff backs the admin order queue (PRD 6.6).
func (s *ServiceOrder) ListForStaff(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestListOrders,
) (*types.ResponseOrderList, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	req.Pagination.Normalize()

	filter := repositories.OrderListFilter{
		RestaurantID: actor.RestaurantID,
		Search:       strings.TrimSpace(req.Search),
		Offset:       req.Pagination.Offset(),
		Limit:        req.Pagination.Limit(),
	}

	// `live` is shorthand for the kitchen board's only real question. Explicit statuses win
	// when both are supplied, since that is the more specific request.
	switch {
	case len(req.Status) > 0:
		for _, raw := range req.Status {
			status := models.OrderStatus(strings.TrimSpace(raw))
			if !status.Valid() {
				return nil, response.ErrOrderInvalidStatus
			}
			filter.Statuses = append(filter.Statuses, status)
		}
	case req.Live:
		filter.Statuses = LiveOrderStatuses()
	}

	if req.PaymentStatus != "" {
		paymentStatus := models.PaymentStatus(req.PaymentStatus)
		if !paymentStatus.Valid() {
			return nil, response.ErrInvalidParams.WithMessage("unknown payment status")
		}
		filter.PaymentStatus = &paymentStatus
	}

	if req.TableUID != "" {
		table, err := s.Access.Repositories.Table.GetByUID(ctx, actor.RestaurantID, req.TableUID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, response.ErrTableNotFound
			}
			log.Errorf("[ListForStaff] table lookup failed: %+v", err)
			return nil, response.ErrOrderFetchFailed
		}
		filter.TableID = &table.ID
	}

	if from, appErr := parseDateParam(req.From); appErr != nil {
		return nil, appErr
	} else if from != nil {
		filter.From = from
	}
	if to, appErr := parseDateParam(req.To); appErr != nil {
		return nil, appErr
	} else if to != nil {
		// Inclusive of the end date: a staff member filtering "to 2026-08-23" means the whole
		// of that day, not midnight at its start.
		end := to.Add(24 * time.Hour)
		filter.To = &end
	}

	orders, total, err := s.Access.Repositories.Order.List(ctx, filter)
	if err != nil {
		log.Errorf("[ListForStaff] list failed: %+v", err)
		return nil, response.ErrOrderFetchFailed
	}

	views := make([]types.OrderView, 0, len(orders))
	for _, order := range orders {
		views = append(views, toOrderView(order, nil, "", ActorStaff))
	}

	return &types.ResponseOrderList{
		Orders: views,
		Meta:   types.NewPageMeta(req.Pagination, total),
	}, nil
}

// GetForStaff returns one order with its full timeline.
func (s *ServiceOrder) GetForStaff(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
) (*types.OrderView, *response.ApplicationError) {
	order, err := s.Access.Repositories.Order.GetByUID(ctx, actor.RestaurantID, uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrOrderNotFound
		}
		s.Access.Logger.With(ctx).Errorf("[GetForStaff] %s: %+v", uid, err)
		return nil, response.ErrOrderFetchFailed
	}

	events, err := s.Access.Repositories.Order.ListStatusEvents(ctx, order.ID)
	if err != nil {
		s.Access.Logger.With(ctx).Warnf("[GetForStaff] timeline unavailable for %s: %+v", uid, err)
	}

	view := toOrderView(order, events, "", ActorStaff)
	return &view, nil
}

// Transition applies a staff-initiated status change (DECISIONS.md D1).
func (s *ServiceOrder) Transition(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
	req *types.RequestTransitionOrder,
) (*types.OrderView, *response.ApplicationError) {
	target := models.OrderStatus(req.Status)
	if !target.Valid() {
		return nil, response.ErrOrderInvalidStatus
	}

	return s.applyTransition(ctx, transitionInput{
		RestaurantID:  actor.RestaurantID,
		RestaurantUID: actor.RestaurantUID,
		OrderUID:      uid,
		Target:        target,
		Actor:         ActorStaff,
		ActorID:       actor.StaffUID,
		Reason:        strings.TrimSpace(req.Reason),
	})
}

// transitionInput carries everything a status change needs.
type transitionInput struct {
	RestaurantID  int32
	RestaurantUID string
	OrderUID      string
	Target        models.OrderStatus
	Actor         Actor
	ActorID       string
	Reason        string
	TableLabel    string
	// RefusalOverride replaces the generic illegal-transition error, so a caller can give a
	// more useful message for its specific case.
	RefusalOverride *response.ApplicationError
}

// applyTransition is the single mutation path for order status.
//
// Every status change in the application funnels through here so that the row lock, the
// state-machine check, the timestamp stamp, the audit event and the realtime publish happen
// together. A second path that did four of the five would produce orders whose timeline and
// status disagree.
func (s *ServiceOrder) applyTransition(
	ctx context.Context,
	in transitionInput,
) (*types.OrderView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	var (
		updated    *models.Order
		orderID    int32
		tableLabel = in.TableLabel
	)

	txErr := s.Access.Db.Transaction(ctx, func(tx *gorm.DB) error {
		// The lock, and the re-read that follows it, are what make two staff phones tapping
		// Accept in the same second resolve to exactly one winner -- and what makes a diner's
		// cancel racing that accept resolve deterministically (DECISIONS.md D1, D6).
		order, err := s.Access.Repositories.Order.LockForUpdate(ctx, tx, in.RestaurantID, in.OrderUID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return response.ErrOrderNotFound
			}
			return fmt.Errorf("lock order: %w", err)
		}

		check := CheckTransition(order.Status, in.Target, in.Actor, in.Reason)
		switch {
		case check.TerminalSource:
			return response.ErrOrderTerminal
		case check.ReasonRequired:
			return response.ErrOrderReasonRequired
		case !check.Allowed:
			// The common, expected case gets its own message so the UI can be specific.
			if in.Target == models.OrderStatusAccepted && order.Status != models.OrderStatusPlaced {
				return response.ErrOrderAlreadyAccepted
			}
			if in.RefusalOverride != nil {
				return in.RefusalOverride
			}
			return response.ErrOrderTransitionIllegal
		}

		now := time.Now().UTC()
		fields := map[string]any{"status": in.Target, "updated_at": now}

		// Stamping the matching timestamp alongside the status, in the same update, is what
		// keeps the diner's timeline and the status column from ever disagreeing.
		if stamp := order.StatusTimestampField(in.Target); stamp != nil {
			fields[statusTimestampColumn(in.Target)] = now
		}
		if in.Reason != "" {
			fields["cancel_reason"] = in.Reason
		}

		if err := s.Access.Repositories.Order.UpdateFields(ctx, tx, order.ID, fields); err != nil {
			return fmt.Errorf("update order: %w", err)
		}

		if err := s.Access.Repositories.Order.AppendStatusEvent(ctx, tx, &models.OrderStatusEvent{
			OrderID:    order.ID,
			FromStatus: order.Status,
			ToStatus:   in.Target,
			ActorType:  actorTypeFor(in.Actor),
			ActorID:    in.ActorID,
			Note:       in.Reason,
		}); err != nil {
			return fmt.Errorf("append status event: %w", err)
		}

		orderID = order.ID
		return nil
	})

	if txErr != nil {
		var appErr *response.ApplicationError
		if errors.As(txErr, &appErr) {
			return nil, appErr
		}
		log.Errorf("[applyTransition] %s -> %s failed: %+v", in.OrderUID, in.Target, txErr)
		return nil, response.ErrOrderUpdateFailed
	}

	// Re-read AFTER the commit, not inside it. GetByID takes no transaction handle, so a read
	// from inside the closure goes to the pool and cannot see this transaction's own uncommitted
	// UPDATE -- it would return the pre-transition status and the client would render a button
	// that has already been pressed.
	updated, err := s.Access.Repositories.Order.GetByID(ctx, in.RestaurantID, orderID)
	if err != nil {
		log.Errorf("[applyTransition] reload after commit failed for %s: %+v", in.OrderUID, err)
		return nil, response.ErrOrderFetchFailed
	}
	if tableLabel == "" && updated.Table != nil {
		tableLabel = updated.Table.Label
	}

	log.Infof("[applyTransition] order %s -> %s by %s(%s)",
		in.OrderUID, in.Target, in.Actor, in.ActorID)

	s.Access.publishOrderEvent(
		types.EventOrderStatusChanged, in.RestaurantUID, in.OrderUID,
		string(updated.Status), tableLabel)

	events, err := s.Access.Repositories.Order.ListStatusEvents(ctx, updated.ID)
	if err != nil {
		log.Warnf("[applyTransition] timeline unavailable: %+v", err)
	}

	view := toOrderView(updated, events, tableLabel, in.Actor)
	return &view, nil
}

// statusTimestampColumn maps a status to the column recording entry into it.
func statusTimestampColumn(status models.OrderStatus) string {
	switch status {
	case models.OrderStatusAccepted:
		return "accepted_at"
	case models.OrderStatusPreparing:
		return "preparing_at"
	case models.OrderStatusReady:
		return "ready_at"
	case models.OrderStatusServed:
		return "served_at"
	case models.OrderStatusCompleted:
		return "completed_at"
	case models.OrderStatusCancelled, models.OrderStatusRejected:
		return "cancelled_at"
	}
	return ""
}

func actorTypeFor(actor Actor) models.ActorType {
	switch actor {
	case ActorGuest:
		return models.ActorTypeGuest
	case ActorStaff:
		return models.ActorTypeStaff
	default:
		return models.ActorTypeSystem
	}
}

// CancelItem voids one line and re-prices the order (PRD 9.1).
func (s *ServiceOrder) CancelItem(
	ctx context.Context,
	actor *StaffPrincipal,
	orderUID, itemUID string,
	req *types.RequestCancelOrderItem,
) (*types.OrderView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	var orderID int32

	txErr := s.Access.Db.Transaction(ctx, func(tx *gorm.DB) error {
		order, err := s.Access.Repositories.Order.LockForUpdate(ctx, tx, actor.RestaurantID, orderUID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return response.ErrOrderNotFound
			}
			return fmt.Errorf("lock order: %w", err)
		}
		if order.Status.IsTerminal() {
			return response.ErrOrderTerminal
		}

		item, err := s.Access.Repositories.Order.GetItemByUID(ctx, tx, order.ID, itemUID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return response.ErrNotFound.WithMessage("that item is not on this order")
			}
			return fmt.Errorf("load order item: %w", err)
		}
		if item.Status == models.OrderItemStatusCancelled {
			return response.ErrConflict.WithMessage("that item is already cancelled")
		}

		lines, err := s.Access.Repositories.Order.ListItems(ctx, order.ID)
		if err != nil {
			return fmt.Errorf("list order items: %w", err)
		}

		// Refuse to empty the order this way. An order with no items and a non-zero total is
		// incoherent, and "cancel the order" is the action the caller actually wants.
		activeRemaining := 0
		for _, line := range lines {
			if line.Status == models.OrderItemStatusActive && line.ID != item.ID {
				activeRemaining++
			}
		}
		if activeRemaining == 0 {
			return response.ErrConflict.WithMessage(
				"this is the only remaining item -- cancel the whole order instead")
		}

		if err := s.Access.Repositories.Order.UpdateItemFields(ctx, tx, item.ID, map[string]any{
			"status": models.OrderItemStatusCancelled,
			"note":   appendReason(item.Note, req.Reason),
		}); err != nil {
			return fmt.Errorf("cancel item: %w", err)
		}

		// Re-price from what is left. The stored totals are authoritative and must not be left
		// describing an order that no longer exists.
		var subtotal int64
		for _, line := range lines {
			if line.ID == item.ID || line.Status != models.OrderItemStatusActive {
				continue
			}
			subtotal += line.TotalMinor
		}

		restaurant, err := s.Access.Repositories.Restaurant.GetByID(ctx, actor.RestaurantID)
		if err != nil {
			return fmt.Errorf("load restaurant: %w", err)
		}

		tax := utils.ApplyBasisPoints(subtotal, restaurant.TaxBps)
		serviceCharge := utils.ApplyBasisPoints(subtotal, restaurant.ServiceChargeBps)

		if err := s.Access.Repositories.Order.UpdateFields(ctx, tx, order.ID, map[string]any{
			"subtotal_minor":       subtotal,
			"tax_minor":            tax,
			"service_charge_minor": serviceCharge,
			"total_minor":          subtotal + tax + serviceCharge - order.DiscountMinor,
			"updated_at":           time.Now().UTC(),
		}); err != nil {
			return fmt.Errorf("reprice order: %w", err)
		}

		// Recorded on the timeline even though the status did not change: "who removed the
		// paneer tikka from table 7's order" has to be answerable.
		if err := s.Access.Repositories.Order.AppendStatusEvent(ctx, tx, &models.OrderStatusEvent{
			OrderID:    order.ID,
			FromStatus: order.Status,
			ToStatus:   order.Status,
			ActorType:  models.ActorTypeStaff,
			ActorID:    actor.StaffUID,
			Note:       fmt.Sprintf("cancelled item %s: %s", item.NameSnapshot, req.Reason),
		}); err != nil {
			return fmt.Errorf("append item-cancel event: %w", err)
		}

		orderID = order.ID
		return nil
	})

	if txErr != nil {
		var appErr *response.ApplicationError
		if errors.As(txErr, &appErr) {
			return nil, appErr
		}
		log.Errorf("[CancelItem] %s/%s failed: %+v", orderUID, itemUID, txErr)
		return nil, response.ErrOrderUpdateFailed
	}

	// After the commit, for the same reason as in applyTransition: a read inside the closure
	// would miss this transaction's own re-priced totals.
	updated, err := s.Access.Repositories.Order.GetByID(ctx, actor.RestaurantID, orderID)
	if err != nil {
		log.Errorf("[CancelItem] reload after commit failed: %+v", err)
		return nil, response.ErrOrderFetchFailed
	}

	log.Infof("[CancelItem] item %s cancelled on order %s by %s", itemUID, orderUID, actor.StaffUID)

	s.Access.publishOrderEvent(
		types.EventOrderStatusChanged, actor.RestaurantUID, orderUID, string(updated.Status), "")

	view := toOrderView(updated, nil, "", ActorStaff)
	return &view, nil
}

// MarkPaidBySystem settles the money side and closes the order if it is already served.
//
// Called by the payment service for both a gateway webhook and a staff confirmation, so
// those two paths produce identical audit trails and identical realtime events.
func (s *ServiceOrder) MarkPaidBySystem(
	ctx context.Context,
	orderID int32,
	actorID string,
) *response.ApplicationError {
	log := s.Access.Logger.With(ctx)

	var (
		restaurantUID string
		orderUID      string
		finalStatus   models.OrderStatus
	)

	txErr := s.Access.Db.Transaction(ctx, func(tx *gorm.DB) error {
		var order models.Order
		if err := tx.WithContext(ctx).Where("id = ?", orderID).First(&order).Error; err != nil {
			return fmt.Errorf("load order %d: %w", orderID, err)
		}

		fields := map[string]any{
			"payment_status": models.PaymentStatusPaid,
			"updated_at":     time.Now().UTC(),
		}
		finalStatus = order.Status

		// A served order that has now been paid for is finished. Advancing it here saves staff
		// a second tap on the one transition that carries no judgement, and it goes through the
		// state machine rather than around it.
		if CheckTransition(order.Status, models.OrderStatusCompleted, ActorSystem, "").Allowed {
			now := time.Now().UTC()
			fields["status"] = models.OrderStatusCompleted
			fields["completed_at"] = now
			finalStatus = models.OrderStatusCompleted

			if err := s.Access.Repositories.Order.AppendStatusEvent(ctx, tx, &models.OrderStatusEvent{
				OrderID:    order.ID,
				FromStatus: order.Status,
				ToStatus:   models.OrderStatusCompleted,
				ActorType:  models.ActorTypeSystem,
				ActorID:    actorID,
				Note:       "closed automatically on payment",
			}); err != nil {
				return fmt.Errorf("append completed event: %w", err)
			}
		}

		if err := s.Access.Repositories.Order.UpdateFields(ctx, tx, order.ID, fields); err != nil {
			return fmt.Errorf("update order: %w", err)
		}

		restaurant, err := s.Access.Repositories.Restaurant.GetByID(ctx, order.RestaurantID)
		if err != nil {
			return fmt.Errorf("load restaurant: %w", err)
		}
		restaurantUID = restaurant.UID
		orderUID = order.UID
		return nil
	})

	if txErr != nil {
		log.Errorf("[MarkPaidBySystem] order %d: %+v", orderID, txErr)
		return response.ErrOrderUpdateFailed
	}

	log.Infof("[MarkPaidBySystem] order %s paid, status now %s", orderUID, finalStatus)

	s.Access.publishOrderEvent(
		types.EventPaymentUpdated, restaurantUID, orderUID, string(finalStatus), "")
	return nil
}

// appendReason joins a staff reason onto an existing item note without losing either.
func appendReason(note, reason string) string {
	reason = strings.TrimSpace(reason)
	switch {
	case reason == "":
		return note
	case note == "":
		return reason
	default:
		return note + " | " + reason
	}
}

// parseDateParam parses a YYYY-MM-DD filter bound.
//
// Rejects a malformed value rather than ignoring it: silently dropping a date filter would
// return the whole order history where the caller asked for one day, which looks like data
// corruption rather than a bad parameter.
func parseDateParam(raw string) (*time.Time, *response.ApplicationError) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parsed, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return nil, response.ErrInvalidParams.WithMessage("dates must be formatted YYYY-MM-DD")
	}
	return &parsed, nil
}
