// Package controllers is the HTTP layer.
//
// Layer contract, and it is a short one:
//   - Bind the request, resolve the principal, call one service method, map the result.
//   - No business logic. If a controller contains an `if` about domain state, that check
//     belongs in the service, where it is testable without a router.
//   - Never construct an ApplicationError from scratch. Errors come from the service; the
//     controller's only error of its own is a bind or parse failure.
//   - Every reply goes through response.Send, so the envelope is identical everywhere.
package controllers

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"tablex/internal/config"
	"tablex/internal/db"
	"tablex/internal/logger"
	"tablex/internal/realtime"
	"tablex/internal/response"
	"tablex/internal/services"
)

// ControllerAccess holds what every controller needs.
type ControllerAccess struct {
	Cfg      *config.Config
	Logger   logger.Logger
	Services *services.Services
	Hub      *realtime.Hub
	// Db is here only for the readiness probe, which must report on the real connection
	// rather than trust that the last request happened to succeed. No other controller
	// touches it -- data access belongs behind a service.
	Db *db.Store
}

// Gin context keys written by middleware and read here. Constants because a mistyped
// string in a ctx.Get would silently yield "no principal" and fail as an auth error rather
// than as the typo it is.
const (
	CtxKeyStaffPrincipal = "staff_principal"
	CtxKeyGuestPrincipal = "guest_principal"
	CtxKeyRequestID      = "request_id"
	CtxKeyIdempotencyKey = "idempotency_key"
)

// Path and header names, likewise.
const (
	PathParamUID      = "uid"
	PathParamItemUID  = "item_uid"
	PathParamQRToken  = "qr_token"
	PathParamSlug     = "slug"
	PathParamProvider = "provider"

	HeaderIdempotencyKey = "Idempotency-Key"
	HeaderGuestToken     = "X-Guest-Token"
)

// staffPrincipal pulls the authenticated staff member out of the context.
//
// Returns ErrTokenMissing rather than panicking on absence: a route wired without its auth
// middleware is a bug, but it should surface as a 401 rather than taking down the process.
func staffPrincipal(ctx *gin.Context) (*services.StaffPrincipal, *response.ApplicationError) {
	v, ok := ctx.Get(CtxKeyStaffPrincipal)
	if !ok {
		return nil, response.ErrTokenMissing
	}
	principal, ok := v.(*services.StaffPrincipal)
	if !ok || principal == nil {
		return nil, response.ErrTokenInvalid
	}
	return principal, nil
}

// guestPrincipal pulls the diner's session out of the context.
func guestPrincipal(ctx *gin.Context) (*services.GuestPrincipal, *response.ApplicationError) {
	v, ok := ctx.Get(CtxKeyGuestPrincipal)
	if !ok {
		return nil, response.ErrSessionMissing
	}
	principal, ok := v.(*services.GuestPrincipal)
	if !ok || principal == nil {
		return nil, response.ErrSessionInvalid
	}
	return principal, nil
}

// queryInt reads an optional integer query parameter, falling back on anything unparseable.
//
// Silent fallback is correct here because these parameters are display hints -- a QR pixel
// size, a page number. Rejecting the whole request over a malformed one would turn a
// cosmetic mistake into a failed page load.
func queryInt(ctx *gin.Context, key string, fallback int) int {
	raw := ctx.Query(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

// Controllers aggregates every HTTP handler.
type Controllers struct {
	Health   *ControllerHealth
	Auth     *ControllerAuth
	Scan     *ControllerScan
	Menu     *ControllerMenu
	Order    *ControllerOrder
	Payment  *ControllerPayment
	Table    *ControllerTable
	Settings *ControllerSettings
	Stats    *ControllerStats
	Realtime *ControllerRealtime
	// Platform is the operator surface. Only reachable through the /api/platform/v1 group,
	// which cmd/app mounts only when a platform token is configured (DECISIONS.md D14).
	Platform *ControllerPlatform
}

// NewControllers wires every controller against one shared Access.
func NewControllers(
	cfg *config.Config,
	log logger.Logger,
	svcs *services.Services,
	hub *realtime.Hub,
	store *db.Store,
) *Controllers {
	access := &ControllerAccess{Cfg: cfg, Logger: log, Services: svcs, Hub: hub, Db: store}

	return &Controllers{
		Health:   NewControllerHealth(access),
		Auth:     NewControllerAuth(access),
		Scan:     NewControllerScan(access),
		Menu:     NewControllerMenu(access),
		Order:    NewControllerOrder(access),
		Payment:  NewControllerPayment(access),
		Table:    NewControllerTable(access),
		Settings: NewControllerSettings(access),
		Stats:    NewControllerStats(access),
		Realtime: NewControllerRealtime(access),
		Platform: NewControllerPlatform(access),
	}
}
