package services

import (
	"time"

	"tablex/internal/models"
)

// When a diner may rate their food.
//
// This file is the single authority on that question, in the same way order_state.go is the
// single authority on legal transitions. Every caller asks it rather than comparing statuses
// inline, so the answer cannot drift between the tracking screen, the API and a later batch job.
//
// # THE PROBLEM IT EXISTS TO SOLVE
//
// The obvious rule -- "reviewable once status is served" -- makes the diner's ability to rate
// depend on staff remembering to tap a button after the food has already left the pass. In a
// real kitchen mid-service that tap is the first thing to go: the order is marked ready, the
// runner takes the plates, and nobody returns to the tablet. Under that rule those diners are
// never asked, and the restaurants with the sloppiest floor discipline -- the ones whose service
// most needs measuring -- collect the least feedback. The rule quietly selects against itself.
//
// So eligibility is derived from SEVERAL independent signals, and the earliest one to fire wins:
//
//  1. served_at / completed_at   The explicit signal. Instant, and the happy path.
//  2. counter payment settled    The diner paid on the way out, so the meal is over. Only
//     meaningful for payment_method=counter: an online_upi order is
//     paid at checkout, BEFORE the food is cooked, so treating "paid"
//     as "eaten" there would ask a diner to rate a dish that has not
//     been started.
//  3. ready_at + grace           The kitchen plated it and stopped tapping. The commonest
//     real-world gap, and the grace period is the delivery walk.
//  4. accepted_at + fallback     The kitchen stopped tapping even earlier. The backstop that
//     guarantees every genuinely-fed diner is eventually asked.
//
// What is NOT a signal, deliberately:
//
//   - status=placed. The kitchen has not even acknowledged the order, so no elapsed time proves
//     food arrived. An unaccepted order stays unreviewable however long it sits.
//   - cancelled / rejected. No food was served. Asking would be insulting, and the rating would
//     describe a dish nobody tasted.
//
// The failure mode being avoided by the two time-based rules having a DELAY rather than firing
// immediately is worth naming: a rating prompt shown before the food arrives is not a smaller
// version of this feature, it is a corrupted dataset. Every star collected that way describes
// anticipation rather than a meal.
const (
	// ReviewGraceAfterReady is how long after "ready" we assume the plates reached the table.
	// It is the walk from the pass, plus slack.
	ReviewGraceAfterReady = 10 * time.Minute

	// ReviewFallbackAfterAccepted is the backstop for an order the kitchen accepted and then
	// stopped updating entirely. Long enough that a slow dish is not rated before it lands,
	// short enough that the diner is still at the table holding the phone they scanned with.
	ReviewFallbackAfterAccepted = 45 * time.Minute

	// ReviewWindow is how long the window stays open, measured from placement. A rating left
	// the next morning is a memory rather than an observation, and leaving it open forever
	// means an old uid keeps a writable endpoint for the life of the deployment.
	ReviewWindow = 24 * time.Hour
)

// ReviewEligibility is the computed answer for one order at one instant.
type ReviewEligibility struct {
	// Open is true when the diner may rate right now. It is the only field the client needs
	// to decide whether to render the card.
	Open bool
	// OpensAt is when the window will open, for an order that is on its way there but not
	// eligible yet. Nil when the window is already open, or when nothing can be predicted --
	// an order the kitchen has not accepted has no schedule yet.
	//
	// Sent to the client so the diner app can set one timer for that exact moment instead of
	// discovering the change on its next poll, which on a served-but-untapped order could be
	// most of a minute late.
	OpensAt *time.Time
	// ClosesAt is when the window shuts. Nil for an order that will never be reviewable.
	ClosesAt *time.Time
}

// ReviewEligibilityFor computes the window for one order.
//
// Pure, and takes now as a parameter, so the whole matrix -- every status, every combination of
// timestamps, both payment methods, both sides of every boundary -- is exhaustively testable
// without a fixture or a sleep.
func ReviewEligibilityFor(order *models.Order, now time.Time) ReviewEligibility {
	if order == nil {
		return ReviewEligibility{}
	}

	// No food was served, so there is nothing to rate. Not "not yet" -- never.
	switch order.Status {
	case models.OrderStatusCancelled, models.OrderStatusRejected:
		return ReviewEligibility{}
	case models.OrderStatusPlaced:
		// The kitchen has not accepted it. No elapsed time proves the food arrived, because
		// as far as the record shows nobody has started cooking.
		return ReviewEligibility{}
	}

	// An order whose every line was cancelled individually has no dish left to rate, even
	// though the order itself is alive (PRD 9.1).
	if len(order.Items) > 0 && len(order.ActiveItems()) == 0 {
		return ReviewEligibility{}
	}

	closesAt := order.PlacedAt.Add(ReviewWindow)
	opensAt, predictable := reviewOpensAt(order)

	// Past the window: the order was reviewable and no longer is. ClosesAt is still reported
	// so a client can distinguish "too late" from "not yet" and say so.
	if !now.Before(closesAt) {
		return ReviewEligibility{ClosesAt: &closesAt}
	}

	if !predictable {
		return ReviewEligibility{ClosesAt: &closesAt}
	}

	if now.Before(opensAt) {
		return ReviewEligibility{OpensAt: &opensAt, ClosesAt: &closesAt}
	}
	return ReviewEligibility{Open: true, ClosesAt: &closesAt}
}

// reviewOpensAt returns the earliest instant at which the food has certainly reached the table,
// and false when no signal on this order can establish one.
//
// Earliest rather than latest: the signals are alternative pieces of evidence for the same
// event, not stages of it. Taking the maximum would make a well-run restaurant that taps every
// status wait out the same 45-minute backstop as one that taps none, which is precisely
// backwards.
func reviewOpensAt(order *models.Order) (time.Time, bool) {
	var earliest time.Time
	found := false

	consider := func(t time.Time) {
		if !found || t.Before(earliest) {
			earliest = t
			found = true
		}
	}

	// 1. The explicit signals.
	if order.ServedAt != nil {
		consider(*order.ServedAt)
	}
	if order.CompletedAt != nil {
		consider(*order.CompletedAt)
	}

	// 2. A settled counter payment. The diner paid on the way out, which they do not do before
	//    eating. Restricted to counter orders on purpose: an online_upi order is paid at
	//    checkout, so there "paid" carries no information about whether the food ever arrived.
	//
	//    Anchored at accepted_at rather than at the settlement time, which the order row does
	//    not carry -- the payment does. Using the anchor we have keeps this a pure function of
	//    the order, and the practical effect is the same: an order that is both accepted and
	//    settled at the counter is one whose diner has finished eating.
	if order.PaymentMethod == models.PaymentMethodCounter &&
		order.PaymentStatus == models.PaymentStatusPaid &&
		order.AcceptedAt != nil {
		consider(*order.AcceptedAt)
	}

	// 3. Plated but never marked served: the commonest gap in a busy kitchen.
	if order.ReadyAt != nil {
		consider(order.ReadyAt.Add(ReviewGraceAfterReady))
	}

	// 4. The backstop. Accepted, then silence.
	if order.AcceptedAt != nil {
		consider(order.AcceptedAt.Add(ReviewFallbackAfterAccepted))
	}

	return earliest, found
}

// CanReviewItem reports whether one line may be rated.
//
// A line the kitchen cancelled individually is excluded: the diner never received it, so a
// rating on it would describe nothing (PRD 9.1).
func CanReviewItem(item *models.OrderItem) bool {
	return item != nil && item.Status == models.OrderItemStatusActive
}
