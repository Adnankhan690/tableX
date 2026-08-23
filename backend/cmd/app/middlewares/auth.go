package middlewares

import (
	"strings"

	"github.com/gin-gonic/gin"

	"tablex/internal/logger"
	"tablex/internal/models"
	"tablex/internal/response"
	"tablex/internal/services"
)

// StaffAuth resolves a staff JWT and puts the principal on the context.
func (m *Middlewares) StaffAuth() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		principal, appErr := m.services.Auth.Authenticate(
			ctx.Request.Context(), m.staffToken(ctx))
		if appErr != nil {
			// Send aborts, so no handler runs.
			response.Send(ctx, nil, appErr)
			return
		}

		ctx.Set(CtxKeyStaffPrincipal, principal)

		// Tenant and actor go into the request context so every log line downstream is
		// attributable without each service re-deriving them.
		reqCtx := logger.WithRestaurantID(ctx.Request.Context(), principal.RestaurantID)
		reqCtx = logger.WithActor(reqCtx, principal.StaffUID)
		ctx.Request = ctx.Request.WithContext(reqCtx)

		ctx.Next()
	}
}

// RequireRole gates a route on the caller's role. Runs after StaffAuth.
//
// The service layer checks permissions again for the operations that need it. That
// duplication is intentional: this middleware protects whole routes cheaply, while the
// service check is the one that still holds if a route is ever wired without this.
func (m *Middlewares) RequireRole(roles ...models.StaffRole) gin.HandlerFunc {
	permitted := make(map[models.StaffRole]bool, len(roles))
	for _, role := range roles {
		permitted[role] = true
	}

	return func(ctx *gin.Context) {
		value, exists := ctx.Get(CtxKeyStaffPrincipal)
		if !exists {
			// The route is misconfigured -- RequireRole without StaffAuth in front of it. A 401
			// is the safe failure; it must never fall through as permitted.
			m.logger.With(ctx.Request.Context()).Errorf(
				"[RequireRole] %s has RequireRole but no StaffAuth", ctx.Request.URL.Path)
			response.Send(ctx, nil, response.ErrTokenMissing)
			return
		}

		principal, ok := value.(*services.StaffPrincipal)
		if !ok || principal == nil {
			response.Send(ctx, nil, response.ErrTokenInvalid)
			return
		}

		if !permitted[principal.Role] {
			response.Send(ctx, nil, response.ErrInsufficientRole)
			return
		}
		ctx.Next()
	}
}

// staffToken finds the bearer token.
//
// The Authorization header is the only accepted source for ordinary requests. The query-string
// fallback exists for exactly one reason: a browser WebSocket cannot set request headers -- there
// is no API for it -- so the admin live feed has no other way to authenticate.
//
// It is therefore gated on the request actually being a WebSocket upgrade. A token in a query
// string is meaningfully worse than one in a header: URLs end up in proxy access logs, browser
// history and Referer headers in a way headers do not. Confining the fallback to upgrade requests
// means every normal API call still refuses a ?token=, so the weaker path cannot be used to
// authenticate anything else -- and it is why the request logger omits query strings entirely.
func (m *Middlewares) staffToken(ctx *gin.Context) string {
	if header := ctx.GetHeader(HeaderAuthorization); header != "" {
		return header
	}
	if isWebSocketUpgrade(ctx) {
		return ctx.Query("token")
	}
	return ""
}

// isWebSocketUpgrade reports whether this request is a WebSocket handshake.
//
// Both headers are checked because either alone is ambiguous, and Connection can legitimately
// arrive as a comma-separated list ("keep-alive, Upgrade") through a proxy.
func isWebSocketUpgrade(ctx *gin.Context) bool {
	if !strings.EqualFold(strings.TrimSpace(ctx.GetHeader("Upgrade")), "websocket") {
		return false
	}
	for _, token := range strings.Split(ctx.GetHeader("Connection"), ",") {
		if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
			return true
		}
	}
	return false
}

// GuestAuth resolves a diner's session token (DECISIONS.md D5).
func (m *Middlewares) GuestAuth() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		token := m.guestToken(ctx)

		principal, appErr := m.services.Session.Authenticate(ctx.Request.Context(), token)
		if appErr != nil {
			response.Send(ctx, nil, appErr)
			return
		}

		ctx.Set(CtxKeyGuestPrincipal, principal)

		reqCtx := logger.WithRestaurantID(ctx.Request.Context(), principal.RestaurantID)
		reqCtx = logger.WithActor(reqCtx, principal.SessionUID)
		ctx.Request = ctx.Request.WithContext(reqCtx)

		ctx.Next()
	}
}

// guestToken finds the session token, checking three places.
//
// X-Guest-Token is the normal path and the bearer form exists for convenience. The query
// parameter is gated on the request being a WebSocket upgrade, for the same reason as
// staffToken: a browser WebSocket cannot set headers, but a token in a URL is more exposed than
// one in a header, so the fallback is confined to the one case that cannot work without it.
func (m *Middlewares) guestToken(ctx *gin.Context) string {
	if token := ctx.GetHeader(HeaderGuestToken); token != "" {
		return token
	}
	if header := ctx.GetHeader(HeaderAuthorization); header != "" {
		if len(header) > 7 && strings.EqualFold(header[:7], "bearer ") {
			return strings.TrimSpace(header[7:])
		}
		return header
	}
	if isWebSocketUpgrade(ctx) {
		return ctx.Query("token")
	}
	return ""
}
