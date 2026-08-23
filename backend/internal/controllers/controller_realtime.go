package controllers

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"tablex/internal/realtime"
	"tablex/internal/response"
	"tablex/internal/types"
)

// maxSocketMessage bounds an inbound frame.
//
// Clients here only ever send pongs, so the limit is deliberately tiny. Without one, a
// client can stream an unbounded frame and exhaust the process's memory.
const maxSocketMessage = 512

// ControllerRealtime serves the WebSocket endpoints (DECISIONS.md D10).
type ControllerRealtime struct {
	Access   *ControllerAccess
	upgrader websocket.Upgrader
}

func NewControllerRealtime(access *ControllerAccess) *ControllerRealtime {
	allowed := access.Cfg.Server.AllowedOrigins

	return &ControllerRealtime{
		Access: access,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			// The default CheckOrigin accepts every origin, which would make this socket
			// readable from any page on the internet that knows a token. The allowlist is the
			// same one CORS uses, so HTTP and WebSocket cannot drift apart.
			CheckOrigin: func(r *http.Request) bool {
				origin := r.Header.Get("Origin")
				// A non-browser client sends no Origin at all -- curl, a health checker, a native
				// app. There is nothing to enforce against, and the bearer token still applies.
				if origin == "" {
					return true
				}
				for _, candidate := range allowed {
					if strings.EqualFold(strings.TrimSpace(candidate), origin) {
						return true
					}
				}
				return false
			},
		},
	}
}

// StaffStream subscribes an admin client to its restaurant's order feed.
func (c *ControllerRealtime) StaffStream(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}
	c.serve(ctx, realtime.RestaurantTopic(actor.RestaurantUID))
}

// GuestStream subscribes a diner to one order's feed.
//
// Ownership is verified through the order service before subscribing. Without that check a
// guest could watch any order by uid, which is exactly the enumeration the per-order topic
// scheme exists to prevent.
func (c *ControllerRealtime) GuestStream(ctx *gin.Context) {
	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	orderUID := ctx.Param(PathParamUID)
	if _, appErr := c.Access.Services.Order.GetForGuest(ctx.Request.Context(), guest, orderUID); appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	c.serve(ctx, realtime.OrderTopic(orderUID))
}

// serve upgrades the connection and pumps events until either side goes away.
func (c *ControllerRealtime) serve(ctx *gin.Context, topic string) {
	log := c.Access.Logger.With(ctx.Request.Context())

	if c.Access.Hub == nil {
		// Realtime is disabled by configuration. A 503 rather than a silent success, so the
		// client falls back to polling immediately instead of waiting on a socket that will
		// never deliver (DECISIONS.md D10).
		response.Send(ctx, nil, response.ErrInternal.WithMessage("realtime updates are disabled"))
		return
	}

	conn, err := c.upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		// Upgrade already wrote a response, so nothing more can be sent.
		log.Warnf("[serve] upgrade failed for %s: %v", topic, err)
		return
	}

	subscriberID := uuid.NewString()
	sub := c.Access.Hub.Subscribe(subscriberID, topic)

	cfg := c.Access.Cfg.Realtime

	defer func() {
		c.Access.Hub.Unsubscribe(subscriberID)
		_ = conn.Close()
		log.Infof("[serve] subscriber %s left %s", subscriberID, topic)
	}()

	log.Infof("[serve] subscriber %s joined %s", subscriberID, topic)

	// The read pump exists only to process pongs and notice the client leaving. Its return
	// closes done, which stops the write pump -- without it a departed client's goroutine
	// would linger until the next publish failed.
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn.SetReadLimit(maxSocketMessage)
		_ = conn.SetReadDeadline(time.Now().Add(cfg.PongWait))
		conn.SetPongHandler(func(string) error {
			return conn.SetReadDeadline(time.Now().Add(cfg.PongWait))
		})
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(cfg.PingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return

		case <-ctx.Request.Context().Done():
			return

		case event, ok := <-sub.Events():
			if !ok {
				// The hub closed us: either shutdown, or this subscriber fell too far behind and
				// was dropped to protect everyone else.
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(cfg.WriteWait))
			if err := conn.WriteJSON(event); err != nil {
				return
			}

		case <-ticker.C:
			// Proxies and mobile networks reap idle sockets. The ping is what keeps a diner's
			// tracking screen connected through a quiet stretch between status changes.
			_ = conn.SetWriteDeadline(time.Now().Add(cfg.WriteWait))
			if err := conn.WriteJSON(types.Event{Type: types.EventPing, At: time.Now().UTC()}); err != nil {
				return
			}
		}
	}
}
