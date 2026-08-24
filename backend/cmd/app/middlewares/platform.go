package middlewares

import (
	"crypto/subtle"
	"strings"

	"github.com/gin-gonic/gin"

	"tablex/internal/logger"
	"tablex/internal/response"
)

// PlatformAuth gates the operator surface on a shared secret (DECISIONS.md D14).
//
// Not a JWT, and not a role on a staff token. A staff JWT carries exactly one restaurant_id
// (DECISIONS.md D3), so there is no principal in the tenant model that could describe someone
// acting across every restaurant -- inventing an "is_platform_admin" claim would mean a token
// issued to a restaurant owner could, if that flag were ever set wrongly, create tenants. The
// secret lives only in the deployment's environment and belongs to no account.
//
// This middleware is the only thing between an anonymous caller and tenant creation, so the
// two ways it could fail open are both closed deliberately:
//
//   - An empty configured token would make every empty header match. The group is not mounted
//     at all in that case (see addPlatformRoutes), and this checks again anyway.
//   - A byte-by-byte string comparison returns early on the first wrong character, which leaks
//     the token one character at a time to anyone who can measure it. subtle.ConstantTimeCompare
//     does not.
func (m *Middlewares) PlatformAuth() gin.HandlerFunc {
	configured := []byte(m.cfg.Platform.AdminToken)

	return func(ctx *gin.Context) {
		// Defence in depth. Reaching here with no configured token means the route was mounted
		// when it should not have been, which is a wiring bug -- and the safe reading of it is
		// "refuse", never "accept anything".
		if len(configured) == 0 {
			m.logger.With(ctx.Request.Context()).Errorf(
				"[PlatformAuth] %s is mounted but no platform token is configured", ctx.Request.URL.Path)
			response.Send(ctx, nil, response.ErrPlatformTokenInvalid)
			return
		}

		presented := []byte(platformToken(ctx))

		// The length check is not a shortcut around the constant-time compare -- it is required,
		// because ConstantTimeCompare returns 0 immediately for unequal lengths and would
		// otherwise be the fast path. Length is not the secret; the bytes are.
		if len(presented) != len(configured) ||
			subtle.ConstantTimeCompare(presented, configured) != 1 {
			// Warn, not Error: a wrong token is a caller mistake or a probe, not a fault of ours.
			// Logged at all because repeated lines here are the signal that someone is guessing.
			m.logger.With(ctx.Request.Context()).Warnf(
				"[PlatformAuth] rejected %s %s", ctx.Request.Method, ctx.Request.URL.Path)
			response.Send(ctx, nil, response.ErrPlatformTokenInvalid)
			return
		}

		// Attributes every log line from here down to the operator rather than to a restaurant.
		// There is no restaurant to scope to yet -- this request is what creates one.
		ctx.Request = ctx.Request.WithContext(
			logger.WithActor(ctx.Request.Context(), ActorPlatform))

		ctx.Next()
	}
}

// ActorPlatform is what appears in the actor field of a log line written under a platform
// token. A fixed string, because the token identifies a deployment, not a person.
const ActorPlatform = "platform"

// platformToken reads the token from X-Platform-Token, falling back to a bearer header.
//
// No query-string fallback. The one that exists for staff and guest tokens is there because a
// browser WebSocket cannot set headers; nothing on this surface is a WebSocket, and a
// tenant-creating secret in a URL would end up in proxy access logs and shell history.
func platformToken(ctx *gin.Context) string {
	if token := ctx.GetHeader(HeaderPlatformToken); token != "" {
		return strings.TrimSpace(token)
	}
	if header := ctx.GetHeader(HeaderAuthorization); header != "" {
		value := strings.TrimSpace(header)
		if len(value) >= 7 && strings.EqualFold(value[:7], "bearer ") {
			return strings.TrimSpace(value[7:])
		}
		return value
	}
	return ""
}
