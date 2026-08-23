// Package realtime carries order updates to connected clients (DECISIONS.md D10).
//
// Two design rules shape everything here.
//
// First, messages are hints, not state. A published Event names an order and a status; a
// client that receives one refetches authoritative state over HTTP. This is what makes a
// dropped frame harmless -- and it is why the polling fallback is a complete substitute
// rather than a degraded mode. The socket is an optimisation on a working baseline, not a
// dependency.
//
// Second, a slow client is disconnected, never waited for. Restaurant wifi produces
// clients that stop reading but never close, and a hub that blocks on them stops
// delivering to everyone else -- so a full send buffer means drop the subscriber.
package realtime

import (
	"sync"
	"sync/atomic"

	"tablex/internal/logger"
	"tablex/internal/types"
)

// Topic naming. Two kinds only: a restaurant feed for the admin panel, and a per-order
// feed for the one diner tracking it.
const (
	topicRestaurantPrefix = "restaurant:"
	topicOrderPrefix      = "order:"
)

// RestaurantTopic is the admin panel's channel: every order event for one restaurant.
func RestaurantTopic(restaurantUID string) string { return topicRestaurantPrefix + restaurantUID }

// OrderTopic is one diner's channel, scoped to the order they placed.
//
// Per-order rather than per-table so a diner cannot subscribe to a neighbouring table's
// traffic by guessing a table label (DECISIONS.md D4).
func OrderTopic(orderUID string) string { return topicOrderPrefix + orderUID }

// Subscriber is one connected client.
type Subscriber struct {
	// ID is unique per connection, so the same client reconnecting is a new subscriber.
	ID string
	// Topics is the set this subscriber receives.
	Topics map[string]bool
	// send is buffered. Its capacity is the whole backpressure policy: once full, this
	// subscriber is dropped rather than allowed to slow the hub.
	send chan types.Event
	// closed guards against a double close when both the reader and the hub decide to
	// drop the same connection at once.
	closed atomic.Bool
}

// Events is the channel a connection's write pump reads from.
func (s *Subscriber) Events() <-chan types.Event { return s.send }

// Hub fans events out to subscribers. Safe for concurrent use.
type Hub struct {
	mu sync.RWMutex
	// topics maps a topic to the subscribers on it. A reverse index rather than scanning
	// every subscriber per publish: the admin panel's topic may have a handful of
	// subscribers while thousands of order topics exist, and publishing must not be O(all
	// connections).
	topics map[string]map[string]*Subscriber
	// subscribers is the flat registry, for unsubscribing by id.
	subscribers map[string]*Subscriber

	bufferSize int
	logger     logger.Logger

	// Counters for the health endpoint. Dropped rising is the signal that clients are too
	// slow or the buffer is too small.
	published atomic.Int64
	dropped   atomic.Int64
}

// NewHub builds a hub. A non-positive bufferSize is replaced with a sane default rather
// than producing an unbuffered channel, which would make every publish block.
func NewHub(bufferSize int, log logger.Logger) *Hub {
	if bufferSize <= 0 {
		bufferSize = 64
	}
	if log == nil {
		log = logger.Discard()
	}
	return &Hub{
		topics:      make(map[string]map[string]*Subscriber),
		subscribers: make(map[string]*Subscriber),
		bufferSize:  bufferSize,
		logger:      log,
	}
}

// Subscribe registers a client on the given topics and returns its subscriber handle.
func (h *Hub) Subscribe(id string, topics ...string) *Subscriber {
	sub := &Subscriber{
		ID:     id,
		Topics: make(map[string]bool, len(topics)),
		send:   make(chan types.Event, h.bufferSize),
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	// Replace any existing subscriber with this id. A client that reconnects before the
	// old connection was reaped would otherwise leave an orphan holding a buffer.
	if existing, ok := h.subscribers[id]; ok {
		h.removeLocked(existing)
	}

	for _, topic := range topics {
		if topic == "" {
			continue
		}
		sub.Topics[topic] = true
		if h.topics[topic] == nil {
			h.topics[topic] = make(map[string]*Subscriber)
		}
		h.topics[topic][id] = sub
	}
	h.subscribers[id] = sub

	return sub
}

// Unsubscribe removes a client and closes its channel.
func (h *Hub) Unsubscribe(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if sub, ok := h.subscribers[id]; ok {
		h.removeLocked(sub)
	}
}

// removeLocked detaches a subscriber. The caller must hold the write lock.
func (h *Hub) removeLocked(sub *Subscriber) {
	for topic := range sub.Topics {
		if subs, ok := h.topics[topic]; ok {
			delete(subs, sub.ID)
			// Drop the topic entry once empty. Without this, a restaurant that has served
			// ten thousand orders holds ten thousand empty maps for the life of the process.
			if len(subs) == 0 {
				delete(h.topics, topic)
			}
		}
	}
	delete(h.subscribers, sub.ID)

	// CompareAndSwap so that a race between the read pump and the hub closing the same
	// subscriber cannot close the channel twice and panic.
	if sub.closed.CompareAndSwap(false, true) {
		close(sub.send)
	}
}

// Publish delivers an event to every subscriber on its topic.
//
// Non-blocking by construction: a subscriber whose buffer is full is dropped, because one
// stalled phone on restaurant wifi must not stop the kitchen board updating.
func (h *Hub) Publish(topic string, event types.Event) {
	event.Topic = topic

	// Collect under a read lock, then send outside it. Sending while holding the lock would
	// let one slow channel block every other publisher.
	h.mu.RLock()
	subs := make([]*Subscriber, 0, len(h.topics[topic]))
	for _, sub := range h.topics[topic] {
		subs = append(subs, sub)
	}
	h.mu.RUnlock()

	if len(subs) == 0 {
		return
	}
	h.published.Add(1)

	var stalled []string
	for _, sub := range subs {
		if sub.closed.Load() {
			continue
		}
		select {
		case sub.send <- event:
		default:
			stalled = append(stalled, sub.ID)
		}
	}

	// Reap the stalled outside the send loop, so one drop does not interrupt delivery to
	// the rest.
	for _, id := range stalled {
		h.dropped.Add(1)
		h.logger.With(nil).Warnf("[Publish] dropping subscriber %s on %s: send buffer full", id, topic)
		h.Unsubscribe(id)
	}
}

// PublishOrderEvent sends one event to both audiences that care: the diner watching this
// order, and the restaurant's admin panel.
//
// Both in one call, because every caller in the application wants both, and leaving it to
// each caller is how the admin board ends up silently missing an event that the diner saw.
func (h *Hub) PublishOrderEvent(restaurantUID, orderUID string, event types.Event) {
	if orderUID != "" {
		h.Publish(OrderTopic(orderUID), event)
	}
	if restaurantUID != "" {
		h.Publish(RestaurantTopic(restaurantUID), event)
	}
}

// Stats reports hub counters for the health endpoint.
func (h *Hub) Stats() Stats {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return Stats{
		Subscribers: len(h.subscribers),
		Topics:      len(h.topics),
		Published:   h.published.Load(),
		Dropped:     h.dropped.Load(),
	}
}

// Stats is a snapshot of hub activity.
type Stats struct {
	Subscribers int   `json:"subscribers"`
	Topics      int   `json:"topics"`
	Published   int64 `json:"published"`
	// Dropped rising means clients are too slow, or the send buffer is too small.
	Dropped int64 `json:"dropped"`
}

// Close disconnects every subscriber. Called on graceful shutdown so clients reconnect to
// the replacement process rather than sitting on a dead socket.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()

	for _, sub := range h.subscribers {
		if sub.closed.CompareAndSwap(false, true) {
			close(sub.send)
		}
	}
	h.topics = make(map[string]map[string]*Subscriber)
	h.subscribers = make(map[string]*Subscriber)
}
