package middlewares

import (
	"time"

	"github.com/gin-gonic/gin"

	"tablex/internal/response"
)

// Logging records one line per request.
func (m *Middlewares) Logging() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		// Health probes fire every few seconds forever. Logging them would bury the requests
		// that matter under probe traffic.
		if isProbe(ctx.Request.URL.Path) {
			ctx.Next()
			return
		}

		started := time.Now()
		ctx.Next()

		log := m.logger.With(ctx.Request.Context())
		status := ctx.Writer.Status()
		latency := time.Since(started)

		// The query string is deliberately excluded: guest tokens travel there on the WebSocket
		// routes, and a token in an access log is a credential in a log.
		switch {
		// 499 is the caller having disconnected (response.StatusClientClosedRequest). It is not a
		// fault, and logging it at Error would defeat the point of distinguishing it in the first
		// place -- but it is worth a line, because a burst of them is a real signal about the
		// network between us and the diner.
		case status == response.StatusClientClosedRequest:
			log.Infof("[HTTP] %s %s -> client disconnected after %s",
				ctx.Request.Method, ctx.Request.URL.Path, latency)
		case status >= 500:
			log.Errorf("[HTTP] %s %s -> %d in %s", ctx.Request.Method, ctx.Request.URL.Path, status, latency)
		case status >= 400:
			log.Warnf("[HTTP] %s %s -> %d in %s", ctx.Request.Method, ctx.Request.URL.Path, status, latency)
		default:
			log.Infof("[HTTP] %s %s -> %d in %s", ctx.Request.Method, ctx.Request.URL.Path, status, latency)
		}
	}
}

func isProbe(path string) bool {
	return path == "/api/public/v1/health/live" || path == "/api/public/v1/health/ready"
}
