package middlewares

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS applies the configured origin allowlist.
//
// The matched origin is echoed back rather than "*". That is not a preference: the diner app
// sends a guest token and the admin app sends a bearer token, and a wildcard
// Access-Control-Allow-Origin is invalid in combination with credentialed requests -- the
// browser rejects the response. Echoing the specific origin is also what keeps an
// unlisted site from reading responses at all.
func (m *Middlewares) CORS() gin.HandlerFunc {
	allowed := make([]string, 0, len(m.cfg.Server.AllowedOrigins))
	for _, origin := range m.cfg.Server.AllowedOrigins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			allowed = append(allowed, trimmed)
		}
	}

	allowHeaders := strings.Join([]string{
		"Content-Type",
		"Authorization",
		HeaderGuestToken,
		HeaderIdempotencyKey,
		HeaderRequestID,
	}, ", ")

	return func(ctx *gin.Context) {
		origin := ctx.GetHeader("Origin")

		if origin != "" && originAllowed(allowed, origin) {
			ctx.Header("Access-Control-Allow-Origin", origin)
			ctx.Header("Access-Control-Allow-Credentials", "true")
			ctx.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
			ctx.Header("Access-Control-Allow-Headers", allowHeaders)
			ctx.Header("Access-Control-Expose-Headers", HeaderRequestID)
			ctx.Header("Access-Control-Max-Age", "600")
			// Responses vary by origin, so a shared cache must not serve one origin's response
			// to another.
			ctx.Header("Vary", "Origin")
		}

		if ctx.Request.Method == http.MethodOptions {
			// Answered here rather than routed: a preflight has no handler to reach, and letting
			// it fall through would 404 and fail the real request that follows.
			ctx.AbortWithStatus(http.StatusNoContent)
			return
		}

		ctx.Next()
	}
}

func originAllowed(allowed []string, origin string) bool {
	for _, candidate := range allowed {
		if strings.EqualFold(candidate, origin) {
			return true
		}
	}
	return false
}
