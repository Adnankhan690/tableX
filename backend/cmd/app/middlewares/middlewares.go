// Package middlewares holds the Gin middleware chain.
//
// Ordering matters and is fixed in cmd/app/app.go rather than here, because a middleware
// cannot know what runs around it.
package middlewares

import (
	"tablex/internal/config"
	"tablex/internal/logger"
	"tablex/internal/services"
)

// Context keys written by middleware and read by controllers.
//
// These string literals are duplicated in internal/controllers/access.go, which is
// unavoidable: making one package import the other would create a cycle. They are
// constants on both sides so a typo is a compile error in at least one place, and the
// route-coverage test asserts the middleware actually populates what controllers read.
const (
	CtxKeyRequestID      = "request_id"
	CtxKeyStaffPrincipal = "staff_principal"
	CtxKeyGuestPrincipal = "guest_principal"
	CtxKeyIdempotencyKey = "idempotency_key"
)

// Header names this API reads.
const (
	HeaderRequestID      = "X-Request-ID"
	HeaderGuestToken     = "X-Guest-Token"
	HeaderIdempotencyKey = "Idempotency-Key"
	HeaderAuthorization  = "Authorization"
)

// Middlewares aggregates every middleware constructor.
type Middlewares struct {
	cfg      *config.Config
	logger   logger.Logger
	services *services.Services

	rateLimiter *rateLimiter
}

// New builds the middleware set.
func New(cfg *config.Config, log logger.Logger, svcs *services.Services) *Middlewares {
	return &Middlewares{
		cfg:         cfg,
		logger:      log,
		services:    svcs,
		rateLimiter: newRateLimiter(cfg.Server.RateLimitPerMinute),
	}
}

// Close releases background resources. Called on graceful shutdown so the rate limiter's
// sweeper goroutine does not outlive the server.
func (m *Middlewares) Close() {
	if m.rateLimiter != nil {
		m.rateLimiter.close()
	}
}
