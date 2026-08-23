package types

import "time"

// EventType names a realtime message (DECISIONS.md D10).
type EventType string

const (
	// EventOrderPlaced reaches the admin panel when a diner checks out.
	EventOrderPlaced EventType = "order.placed"
	// EventOrderStatusChanged reaches both sides on every transition.
	EventOrderStatusChanged EventType = "order.status_changed"
	// EventPaymentUpdated reaches both sides when money settles.
	EventPaymentUpdated EventType = "payment.updated"
	// EventMenuItemAvailability reaches diners when the kitchen marks a dish sold out, so
	// a cart can be corrected before checkout rather than rejected at it.
	EventMenuItemAvailability EventType = "menu.availability_changed"
	// EventPing keeps the connection alive through proxies that reap idle sockets.
	EventPing EventType = "ping"
)

// Event is the realtime envelope.
//
// Payloads are deliberately thin -- identifiers and a status, not a whole order. A client
// receiving one refetches authoritative state over HTTP. That is what makes a dropped
// frame harmless and stops the socket from becoming a second, divergent source of truth
// (DECISIONS.md D10).
type Event struct {
	Type EventType `json:"type"`
	// Topic is the channel this was published to: "restaurant:{uid}" or "order:{uid}".
	Topic      string    `json:"topic"`
	OrderUID   string    `json:"order_uid,omitempty"`
	Status     string    `json:"status,omitempty"`
	TableLabel string    `json:"table_label,omitempty"`
	At         time.Time `json:"at"`
}
