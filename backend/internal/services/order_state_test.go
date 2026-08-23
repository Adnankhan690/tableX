package services

import (
	"testing"

	"tablex/internal/models"
)

// allStatuses is every status the enum defines, so the matrix tests below cover the whole
// space rather than the handful of cases someone thought of.
var allStatuses = []models.OrderStatus{
	models.OrderStatusPlaced,
	models.OrderStatusAccepted,
	models.OrderStatusPreparing,
	models.OrderStatusReady,
	models.OrderStatusServed,
	models.OrderStatusCompleted,
	models.OrderStatusRejected,
	models.OrderStatusCancelled,
}

var allActors = []Actor{ActorGuest, ActorStaff, ActorSystem}

func TestCheckTransition_HappyPath(t *testing.T) {
	// The full staff path from placement to close.
	path := []struct {
		from, to models.OrderStatus
	}{
		{models.OrderStatusPlaced, models.OrderStatusAccepted},
		{models.OrderStatusAccepted, models.OrderStatusPreparing},
		{models.OrderStatusPreparing, models.OrderStatusReady},
		{models.OrderStatusReady, models.OrderStatusServed},
		{models.OrderStatusServed, models.OrderStatusCompleted},
	}

	for _, step := range path {
		got := CheckTransition(step.from, step.to, ActorStaff, "")
		if !got.Allowed {
			t.Errorf("staff %s -> %s: want allowed, got %+v", step.from, step.to, got)
		}
	}
}

func TestCheckTransition_TerminalStatesAreFinal(t *testing.T) {
	// Nothing moves out of a closed order, for any actor, to any status. This is the
	// invariant that keeps a settled bill settled.
	for _, from := range []models.OrderStatus{
		models.OrderStatusCompleted, models.OrderStatusRejected, models.OrderStatusCancelled,
	} {
		for _, to := range allStatuses {
			for _, actor := range allActors {
				got := CheckTransition(from, to, actor, "a reason")
				if got.Allowed {
					t.Errorf("%s actor moved terminal %s -> %s, must be impossible", actor, from, to)
				}
				if !got.TerminalSource {
					t.Errorf("%s -> %s (%s): want TerminalSource, got %+v", from, to, actor, got)
				}
			}
		}
	}
}

func TestCheckTransition_GuestMayOnlyCancelFromPlaced(t *testing.T) {
	// The whole of a guest's power over an order (DECISIONS.md D6). Asserted as a matrix
	// so a later edit that widens guest rights fails here rather than in production.
	for _, from := range allStatuses {
		for _, to := range allStatuses {
			got := CheckTransition(from, to, ActorGuest, "")

			wantAllowed := from == models.OrderStatusPlaced && to == models.OrderStatusCancelled
			if got.Allowed != wantAllowed {
				t.Errorf("guest %s -> %s: allowed=%v want %v", from, to, got.Allowed, wantAllowed)
			}
		}
	}
}

func TestCheckTransition_GuestCannotCancelAfterAccept(t *testing.T) {
	// The specific case the diner app has to handle: they tapped cancel just as the kitchen
	// accepted (DECISIONS.md D6).
	for _, from := range []models.OrderStatus{
		models.OrderStatusAccepted, models.OrderStatusPreparing,
		models.OrderStatusReady, models.OrderStatusServed,
	} {
		if CheckTransition(from, models.OrderStatusCancelled, ActorGuest, "").Allowed {
			t.Errorf("guest cancelled from %s: the kitchen has already started", from)
		}
		// Staff still can, with a reason.
		if !CheckTransition(from, models.OrderStatusCancelled, ActorStaff, "out of stock").Allowed {
			if from == models.OrderStatusServed || from == models.OrderStatusReady {
				continue // by design: a served order is closed out, not cancelled
			}
			t.Errorf("staff could not cancel from %s", from)
		}
	}
}

func TestCheckTransition_ReasonRequiredEdges(t *testing.T) {
	cases := []struct {
		name     string
		from, to models.OrderStatus
		actor    Actor
	}{
		{"reject a new order", models.OrderStatusPlaced, models.OrderStatusRejected, ActorStaff},
		{"cancel after accepting", models.OrderStatusAccepted, models.OrderStatusCancelled, ActorStaff},
		{"cancel while preparing", models.OrderStatusPreparing, models.OrderStatusCancelled, ActorStaff},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Without a reason: refused, and flagged as the reason being the problem rather
			// than the move being illegal, so the API can say something useful.
			blank := CheckTransition(tc.from, tc.to, tc.actor, "")
			if blank.Allowed {
				t.Errorf("%s -> %s allowed with no reason", tc.from, tc.to)
			}
			if !blank.ReasonRequired {
				t.Errorf("%s -> %s: want ReasonRequired, got %+v", tc.from, tc.to, blank)
			}

			// With a reason: allowed.
			withReason := CheckTransition(tc.from, tc.to, tc.actor, "we ran out of paneer")
			if !withReason.Allowed {
				t.Errorf("%s -> %s refused despite a reason: %+v", tc.from, tc.to, withReason)
			}
		})
	}
}

func TestCheckTransition_GuestCancelNeedsNoReason(t *testing.T) {
	// Asymmetric on purpose: a diner changing their mind owes no explanation, and demanding
	// one would be a pointless obstacle on a phone.
	got := CheckTransition(models.OrderStatusPlaced, models.OrderStatusCancelled, ActorGuest, "")
	if !got.Allowed {
		t.Fatalf("guest cancel from placed refused: %+v", got)
	}
}

func TestCheckTransition_NoSkippingStates(t *testing.T) {
	// An order cannot jump the queue. Explicitly covers the case an over-eager UI would
	// produce: placed straight to served.
	illegal := []struct{ from, to models.OrderStatus }{
		{models.OrderStatusPlaced, models.OrderStatusPreparing},
		{models.OrderStatusPlaced, models.OrderStatusReady},
		{models.OrderStatusPlaced, models.OrderStatusServed},
		{models.OrderStatusPlaced, models.OrderStatusCompleted},
		{models.OrderStatusAccepted, models.OrderStatusReady},
		{models.OrderStatusAccepted, models.OrderStatusServed},
		{models.OrderStatusPreparing, models.OrderStatusServed},
		{models.OrderStatusPreparing, models.OrderStatusCompleted},
		{models.OrderStatusReady, models.OrderStatusCompleted},
	}

	for _, tc := range illegal {
		for _, actor := range allActors {
			if CheckTransition(tc.from, tc.to, actor, "reason").Allowed {
				t.Errorf("%s skipped %s -> %s", actor, tc.from, tc.to)
			}
		}
	}
}

func TestCheckTransition_NoBackwardMoves(t *testing.T) {
	// Rank orders the forward path; any edge that decreases rank is a regression the
	// kitchen board must never offer.
	rank := map[models.OrderStatus]int{
		models.OrderStatusPlaced:    0,
		models.OrderStatusAccepted:  1,
		models.OrderStatusPreparing: 2,
		models.OrderStatusReady:     3,
		models.OrderStatusServed:    4,
		models.OrderStatusCompleted: 5,
	}

	for from, fr := range rank {
		for to, tr := range rank {
			if tr >= fr {
				continue
			}
			for _, actor := range allActors {
				if CheckTransition(from, to, actor, "reason").Allowed {
					t.Errorf("%s moved backwards %s -> %s", actor, from, to)
				}
			}
		}
	}
}

func TestCheckTransition_SelfTransitionIsIllegal(t *testing.T) {
	// Re-accepting an accepted order must fail rather than no-op. This is the double-tap
	// case from two staff phones: the loser needs to be told, not silently succeed
	// (DECISIONS.md D1).
	for _, s := range allStatuses {
		for _, actor := range allActors {
			if CheckTransition(s, s, actor, "reason").Allowed {
				t.Errorf("%s re-applied %s to itself", actor, s)
			}
		}
	}
}

func TestCheckTransition_UnknownStatusIsRefused(t *testing.T) {
	// A row holding a status this build does not know (a rolled-back deploy) must freeze,
	// not be forced onward.
	got := CheckTransition(models.OrderStatus("wat"), models.OrderStatusAccepted, ActorStaff, "")
	if got.Allowed {
		t.Errorf("transition allowed from an unknown status: %+v", got)
	}
}

func TestNextStatuses_MatchesCheckTransition(t *testing.T) {
	// The list the admin panel renders its buttons from must agree exactly with what the
	// validator will accept -- otherwise the UI offers a button that 409s. Reason-gated
	// edges are included: the UI shows them and prompts for the reason.
	for _, from := range allStatuses {
		for _, actor := range allActors {
			for _, to := range NextStatuses(from, actor) {
				chk := CheckTransition(from, models.OrderStatus(to), actor, "a reason")
				if !chk.Allowed {
					t.Errorf("NextStatuses(%s, %s) offered %s but CheckTransition refuses it",
						from, actor, to)
				}
			}
		}
	}
}

func TestNextStatuses_TerminalIsEmpty(t *testing.T) {
	for _, s := range []models.OrderStatus{
		models.OrderStatusCompleted, models.OrderStatusRejected, models.OrderStatusCancelled,
	} {
		for _, actor := range allActors {
			if got := NextStatuses(s, actor); len(got) != 0 {
				t.Errorf("NextStatuses(%s, %s) = %v, want empty", s, actor, got)
			}
		}
	}
}

func TestNextStatuses_IsSorted(t *testing.T) {
	// Stable ordering keeps the admin panel's buttons from reshuffling between refreshes,
	// which map iteration would otherwise cause.
	for _, from := range allStatuses {
		for _, actor := range allActors {
			got := NextStatuses(from, actor)
			for i := 1; i < len(got); i++ {
				if got[i-1] > got[i] {
					t.Errorf("NextStatuses(%s, %s) = %v, not sorted", from, actor, got)
				}
			}
		}
	}
}

func TestCanGuestCancel(t *testing.T) {
	for _, s := range allStatuses {
		want := s == models.OrderStatusPlaced
		if got := CanGuestCancel(s); got != want {
			t.Errorf("CanGuestCancel(%s) = %v, want %v", s, got, want)
		}
	}
}

func TestLiveOrderStatuses_AreAllNonTerminal(t *testing.T) {
	live := LiveOrderStatuses()
	for _, s := range live {
		if s.IsTerminal() {
			t.Errorf("LiveOrderStatuses included terminal %s", s)
		}
	}
	// And covers every non-terminal status, so the kitchen board cannot silently omit one.
	seen := make(map[models.OrderStatus]bool, len(live))
	for _, s := range live {
		seen[s] = true
	}
	for _, s := range allStatuses {
		if !s.IsTerminal() && !seen[s] {
			t.Errorf("LiveOrderStatuses is missing non-terminal status %s", s)
		}
	}
}

func TestTransitionRequiresReason(t *testing.T) {
	cases := []struct {
		from, to models.OrderStatus
		want     bool
	}{
		{models.OrderStatusPlaced, models.OrderStatusRejected, true},
		{models.OrderStatusAccepted, models.OrderStatusCancelled, true},
		{models.OrderStatusPreparing, models.OrderStatusCancelled, true},
		{models.OrderStatusPlaced, models.OrderStatusCancelled, false},
		{models.OrderStatusPlaced, models.OrderStatusAccepted, false},
		{models.OrderStatusServed, models.OrderStatusCompleted, false},
		// An illegal edge requires nothing, because it will never be taken.
		{models.OrderStatusPlaced, models.OrderStatusServed, false},
	}

	for _, tc := range cases {
		if got := TransitionRequiresReason(tc.from, tc.to); got != tc.want {
			t.Errorf("TransitionRequiresReason(%s, %s) = %v, want %v", tc.from, tc.to, got, tc.want)
		}
	}
}

func TestOrderStatus_IsTerminal(t *testing.T) {
	terminal := map[models.OrderStatus]bool{
		models.OrderStatusCompleted: true,
		models.OrderStatusRejected:  true,
		models.OrderStatusCancelled: true,
	}
	for _, s := range allStatuses {
		if got := s.IsTerminal(); got != terminal[s] {
			t.Errorf("%s.IsTerminal() = %v, want %v", s, got, terminal[s])
		}
		if s.IsLive() == s.IsTerminal() {
			t.Errorf("%s: IsLive and IsTerminal agree, they must be opposites", s)
		}
	}
}
