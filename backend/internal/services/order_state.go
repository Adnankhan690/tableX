package services

import (
	"sort"

	"tablex/internal/models"
)

// The order state machine (DECISIONS.md D1).
//
// This file is the single authority on which status transitions are legal and who may
// perform them. Every mutation path -- staff action, guest cancel, payment webhook --
// asks this table rather than checking statuses inline. That is what stops the fourth
// caller added six months from now from inventing its own rule and letting an order jump
// from placed straight to served.
//
// The transition table is data, not branching logic, so it can be exhaustively tested and
// read at a glance.

// Actor is who is attempting a transition. Guests and staff have deliberately different
// powers: a guest may withdraw an order the kitchen has not started, and nothing else.
type Actor string

const (
	// ActorGuest is the diner, holding a guest session token.
	ActorGuest Actor = "guest"
	// ActorStaff is an authenticated staff member.
	ActorStaff Actor = "staff"
	// ActorSystem is the application itself -- a payment webhook completing a served
	// order, for instance. It is allowed every staff transition, because it only ever acts
	// on rules encoded elsewhere in this package.
	ActorSystem Actor = "system"
)

// transition describes one legal edge in the state machine.
type transition struct {
	// actors is the set permitted to take this edge.
	actors map[Actor]bool
	// requiresReason forces a caller to explain itself. Applied to the two edges a diner
	// experiences as their order disappearing -- reject and staff-cancel -- so the diner
	// can be told why rather than left guessing (DECISIONS.md D1).
	requiresReason bool
}

// staffOnly is the common case: staff and system, not guests.
func staffOnly() map[Actor]bool {
	return map[Actor]bool{ActorStaff: true, ActorSystem: true}
}

// orderTransitions is the complete legal graph. An edge absent from this map is illegal,
// which makes the default deny rather than allow.
var orderTransitions = map[models.OrderStatus]map[models.OrderStatus]transition{
	models.OrderStatusPlaced: {
		models.OrderStatusAccepted: {actors: staffOnly()},
		models.OrderStatusRejected: {actors: staffOnly(), requiresReason: true},
		// The one edge a guest owns: withdrawing an order the kitchen has not started
		// (DECISIONS.md D6).
		models.OrderStatusCancelled: {
			actors:         map[Actor]bool{ActorGuest: true, ActorStaff: true, ActorSystem: true},
			requiresReason: false,
		},
	},
	models.OrderStatusAccepted: {
		models.OrderStatusPreparing: {actors: staffOnly()},
		// Staff may still cancel after accepting -- the ingredient ran out -- but must say
		// why, because by now the diner has been told their order was accepted.
		models.OrderStatusCancelled: {actors: staffOnly(), requiresReason: true},
	},
	models.OrderStatusPreparing: {
		models.OrderStatusReady:     {actors: staffOnly()},
		models.OrderStatusCancelled: {actors: staffOnly(), requiresReason: true},
	},
	models.OrderStatusReady: {
		models.OrderStatusServed: {actors: staffOnly()},
	},
	models.OrderStatusServed: {
		models.OrderStatusCompleted: {actors: staffOnly()},
	},
	// Terminal states have no outgoing edges. Present as empty maps rather than absent, so
	// "unknown status" and "closed order" are distinguishable.
	models.OrderStatusCompleted: {},
	models.OrderStatusRejected:  {},
	models.OrderStatusCancelled: {},
}

// TransitionCheck is the outcome of validating a proposed transition.
type TransitionCheck struct {
	// Allowed is true only when this actor may make this exact move right now.
	Allowed bool
	// ReasonRequired is true when the edge is legal but the caller supplied no reason.
	ReasonRequired bool
	// TerminalSource is true when the order is already closed, which the caller reports
	// differently from an out-of-order move.
	TerminalSource bool
}

// CheckTransition validates a proposed move without applying it.
//
// It is pure and takes no database handle, so the whole matrix -- every from-state, every
// to-state, every actor -- is exhaustively testable without a fixture.
func CheckTransition(from, to models.OrderStatus, actor Actor, reason string) TransitionCheck {
	if from.IsTerminal() {
		return TransitionCheck{TerminalSource: true}
	}

	edges, known := orderTransitions[from]
	if !known {
		// An unrecognised current status means the row holds something this build does not
		// understand -- a rolled-back deploy, say. Refusing to move it is the safe answer.
		return TransitionCheck{}
	}

	edge, ok := edges[to]
	if !ok || !edge.actors[actor] {
		return TransitionCheck{}
	}

	if edge.requiresReason && reason == "" {
		return TransitionCheck{Allowed: false, ReasonRequired: true}
	}
	return TransitionCheck{Allowed: true}
}

// NextStatuses returns the statuses this actor may move the order to from here, sorted for
// a stable API response.
//
// The admin panel renders its action buttons from this list, so the state machine has
// exactly one definition and the UI cannot drift from it (DECISIONS.md D1).
func NextStatuses(from models.OrderStatus, actor Actor) []string {
	edges, known := orderTransitions[from]
	if !known {
		return nil
	}

	out := make([]string, 0, len(edges))
	for to, edge := range edges {
		if edge.actors[actor] {
			out = append(out, string(to))
		}
	}
	sort.Strings(out)
	return out
}

// TransitionRequiresReason reports whether this edge must carry an explanation.
func TransitionRequiresReason(from, to models.OrderStatus) bool {
	if edges, ok := orderTransitions[from]; ok {
		if edge, ok := edges[to]; ok {
			return edge.requiresReason
		}
	}
	return false
}

// CanGuestCancel reports whether a diner may still withdraw this order themselves. Sent
// on every OrderView so the diner app shows a cancel button exactly when it will work
// (DECISIONS.md D6).
func CanGuestCancel(status models.OrderStatus) bool {
	return CheckTransition(status, models.OrderStatusCancelled, ActorGuest, "").Allowed
}

// LiveOrderStatuses is the set of non-terminal statuses, for the kitchen board's query.
func LiveOrderStatuses() []models.OrderStatus {
	return []models.OrderStatus{
		models.OrderStatusPlaced,
		models.OrderStatusAccepted,
		models.OrderStatusPreparing,
		models.OrderStatusReady,
		models.OrderStatusServed,
	}
}
