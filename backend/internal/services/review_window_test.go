package services

import (
	"testing"
	"time"

	"tablex/internal/models"
)

// base is an arbitrary fixed instant. Every timestamp in this file is an offset from it, so
// no test depends on the wall clock and none of them sleep.
var base = time.Date(2026, 3, 14, 19, 30, 0, 0, time.UTC)

func at(d time.Duration) *time.Time {
	t := base.Add(d)
	return &t
}

// order builds a minimal reviewable-shaped order. Tests override only the fields they are
// actually about, so what each case is exercising stays legible.
func order(status models.OrderStatus, mutate func(*models.Order)) *models.Order {
	o := &models.Order{
		Status:        status,
		PlacedAt:      base,
		PaymentMethod: models.PaymentMethodOnlineUPI,
		PaymentStatus: models.PaymentStatusPending,
		Items: []models.OrderItem{
			{Status: models.OrderItemStatusActive},
		},
	}
	if mutate != nil {
		mutate(o)
	}
	return o
}

// TestReviewEligibility_NeverOpens covers the states where no elapsed time can ever make an
// order reviewable. These are the cases where opening the window would produce a rating of a
// dish nobody ate.
func TestReviewEligibility_NeverOpens(t *testing.T) {
	// Deliberately far in the future: if any of these were merely "not yet", a long enough
	// wait would flip them, and this is exactly what must not happen.
	late := base.Add(30 * time.Minute)

	cases := []struct {
		name  string
		order *models.Order
	}{
		{
			// The kitchen never acknowledged the order. No amount of waiting proves food arrived.
			name:  "placed and never accepted",
			order: order(models.OrderStatusPlaced, func(o *models.Order) { o.PlacedAt = base.Add(-6 * time.Hour) }),
		},
		{
			name: "cancelled",
			order: order(models.OrderStatusCancelled, func(o *models.Order) {
				o.AcceptedAt, o.CancelledAt = at(2*time.Minute), at(5*time.Minute)
			}),
		},
		{
			name: "rejected",
			order: order(models.OrderStatusRejected, func(o *models.Order) {
				o.CancelledAt = at(2 * time.Minute)
			}),
		},
		{
			// Cancelled after being served: the food came back. Terminal-cancelled wins over
			// served_at, or a diner would be asked to rate a refunded meal.
			name: "cancelled after having been served",
			order: order(models.OrderStatusCancelled, func(o *models.Order) {
				o.AcceptedAt, o.ServedAt, o.CancelledAt = at(2*time.Minute), at(20*time.Minute), at(25*time.Minute)
			}),
		},
		{
			// Every line voided individually (PRD 9.1). The order lives; the food does not.
			name: "served but every line cancelled",
			order: order(models.OrderStatusServed, func(o *models.Order) {
				o.AcceptedAt, o.ServedAt = at(2*time.Minute), at(20*time.Minute)
				o.Items = []models.OrderItem{{Status: models.OrderItemStatusCancelled}}
			}),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ReviewEligibilityFor(tc.order, late)
			if got.Open {
				t.Fatalf("window opened for %q; a diner would be asked to rate food they never received", tc.name)
			}
			if got.OpensAt != nil {
				t.Fatalf("window advertised a future opening at %v for %q; it must never open", *got.OpensAt, tc.name)
			}
		})
	}
}

// TestReviewEligibility_ExplicitSignals covers the happy path: staff tapped the button.
func TestReviewEligibility_ExplicitSignals(t *testing.T) {
	served := order(models.OrderStatusServed, func(o *models.Order) {
		o.AcceptedAt, o.ReadyAt, o.ServedAt = at(2*time.Minute), at(18*time.Minute), at(20*time.Minute)
	})

	// One second before the tap, the window is shut.
	if got := ReviewEligibilityFor(served, base.Add(20*time.Minute-time.Second)); got.Open {
		t.Fatal("window was open before served_at")
	}
	// At the tap, it is open -- with no delay at all, because this signal is certain.
	if got := ReviewEligibilityFor(served, base.Add(20*time.Minute)); !got.Open {
		t.Fatal("window did not open at served_at")
	}

	completed := order(models.OrderStatusCompleted, func(o *models.Order) {
		o.AcceptedAt, o.CompletedAt = at(2*time.Minute), at(40*time.Minute)
	})
	if got := ReviewEligibilityFor(completed, base.Add(40*time.Minute)); !got.Open {
		t.Fatal("window did not open at completed_at")
	}
}

// TestReviewEligibility_ReadyButNeverServed is the gap this whole policy exists for: the
// kitchen plated the food and stopped tapping. Under a naive status == served rule these
// diners are never asked.
func TestReviewEligibility_ReadyButNeverServed(t *testing.T) {
	o := order(models.OrderStatusReady, func(m *models.Order) {
		m.AcceptedAt, m.ReadyAt = at(2*time.Minute), at(15*time.Minute)
	})

	justBefore := base.Add(15*time.Minute + ReviewGraceAfterReady - time.Second)
	if got := ReviewEligibilityFor(o, justBefore); got.Open {
		t.Fatal("window opened during the grace period; the plates may still be on the pass")
	} else if got.OpensAt == nil {
		t.Fatal("a ready order must advertise when it will become reviewable, so the client can set a timer")
	} else if want := base.Add(15*time.Minute + ReviewGraceAfterReady); !got.OpensAt.Equal(want) {
		t.Fatalf("opens_at = %v, want %v", *got.OpensAt, want)
	}

	if got := ReviewEligibilityFor(o, base.Add(15*time.Minute+ReviewGraceAfterReady)); !got.Open {
		t.Fatal("window never opened for a ready order staff forgot to mark served")
	}
}

// TestReviewEligibility_AcceptedThenSilence is the worst case: the kitchen accepted the order
// and touched nothing else. The backstop must still reach the diner.
func TestReviewEligibility_AcceptedThenSilence(t *testing.T) {
	for _, status := range []models.OrderStatus{models.OrderStatusAccepted, models.OrderStatusPreparing} {
		t.Run(string(status), func(t *testing.T) {
			o := order(status, func(m *models.Order) { m.AcceptedAt = at(2 * time.Minute) })

			if got := ReviewEligibilityFor(o, base.Add(2*time.Minute+ReviewFallbackAfterAccepted-time.Second)); got.Open {
				t.Fatal("window opened before the backstop elapsed; the food may not have arrived")
			}
			if got := ReviewEligibilityFor(o, base.Add(2*time.Minute+ReviewFallbackAfterAccepted)); !got.Open {
				t.Fatalf("backstop never fired for a %s order; this diner is never asked to rate", status)
			}
		})
	}
}

// TestReviewEligibility_CounterPaymentIsASignal covers the third independent signal, and the
// asymmetry between the two payment methods that makes it valid.
func TestReviewEligibility_CounterPaymentIsASignal(t *testing.T) {
	// Counter: the diner pays on the way out, so a settled payment means the meal is over.
	// This must beat the 45-minute backstop.
	counter := order(models.OrderStatusPreparing, func(o *models.Order) {
		o.AcceptedAt = at(2 * time.Minute)
		o.PaymentMethod, o.PaymentStatus = models.PaymentMethodCounter, models.PaymentStatusPaid
	})
	if got := ReviewEligibilityFor(counter, base.Add(10*time.Minute)); !got.Open {
		t.Fatal("a settled counter payment did not open the window; the diner has already paid and left")
	}

	// Online UPI: paid at CHECKOUT, before the kitchen has even started. Treating this as
	// evidence the food arrived would ask a diner to rate an uncooked dish -- the single
	// worst failure this policy can have, so it is asserted explicitly.
	online := order(models.OrderStatusAccepted, func(o *models.Order) {
		o.AcceptedAt = at(2 * time.Minute)
		o.PaymentMethod, o.PaymentStatus = models.PaymentMethodOnlineUPI, models.PaymentStatusPaid
	})
	if got := ReviewEligibilityFor(online, base.Add(10*time.Minute)); got.Open {
		t.Fatal("an online payment opened the window; that money was taken before the food was cooked")
	}
}

// TestReviewEligibility_EarliestSignalWins guards the rule that the signals are alternative
// evidence rather than sequential stages. Taking the latest would punish a diligent kitchen.
func TestReviewEligibility_EarliestSignalWins(t *testing.T) {
	// served_at fires at +20m; the accepted backstop would not fire until +47m.
	o := order(models.OrderStatusServed, func(m *models.Order) {
		m.AcceptedAt, m.ReadyAt, m.ServedAt = at(2*time.Minute), at(18*time.Minute), at(20*time.Minute)
	})

	got := ReviewEligibilityFor(o, base.Add(21*time.Minute))
	if !got.Open {
		t.Fatal("a restaurant that taps every status waited out the backstop meant for one that taps none")
	}
}

// TestReviewEligibility_WindowCloses covers the far edge.
func TestReviewEligibility_WindowCloses(t *testing.T) {
	o := order(models.OrderStatusCompleted, func(m *models.Order) {
		m.AcceptedAt, m.ServedAt, m.CompletedAt = at(2*time.Minute), at(20*time.Minute), at(30*time.Minute)
	})

	if got := ReviewEligibilityFor(o, base.Add(ReviewWindow-time.Second)); !got.Open {
		t.Fatal("window shut early")
	}
	got := ReviewEligibilityFor(o, base.Add(ReviewWindow))
	if got.Open {
		t.Fatal("window stayed open past its close; an old uid keeps a writable endpoint forever")
	}
	if got.ClosesAt == nil {
		t.Fatal("closes_at must survive the close, so a client can say 'too late' rather than 'not yet'")
	}
}

// TestReviewEligibility_NilOrder guards the boundary rather than panicking on it.
func TestReviewEligibility_NilOrder(t *testing.T) {
	if got := ReviewEligibilityFor(nil, base); got.Open {
		t.Fatal("a nil order was reviewable")
	}
}

// TestCanReviewItem covers the per-line rule.
func TestCanReviewItem(t *testing.T) {
	if !CanReviewItem(&models.OrderItem{Status: models.OrderItemStatusActive}) {
		t.Fatal("an active line must be reviewable")
	}
	if CanReviewItem(&models.OrderItem{Status: models.OrderItemStatusCancelled}) {
		t.Fatal("a line the kitchen cancelled was reviewable; the diner never received it")
	}
	if CanReviewItem(nil) {
		t.Fatal("a nil line was reviewable")
	}
}
