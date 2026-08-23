package middlewares

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"tablex/internal/logger"
)

// RequestID assigns a correlation id to every request.
//
// An inbound X-Request-ID is preserved rather than replaced, so a trace that started at the
// load balancer or in the diner app stays one trace through to the database log line. The
// id is also echoed in the response envelope, which is how a diner reading an error off
// their phone gives a developer something to grep for.
func (m *Middlewares) RequestID() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		id := ctx.GetHeader(HeaderRequestID)
		if id == "" {
			id = uuid.NewString()
		}
		// Bounded: the value is attacker-controlled and ends up in every log line for this
		// request, so a megabyte header must not become a megabyte of logs.
		if len(id) > 128 {
			id = id[:128]
		}

		ctx.Set(CtxKeyRequestID, id)
		ctx.Header(HeaderRequestID, id)

		// Threaded into the request context so services and repositories -- which never see the
		// gin context -- log the same id.
		ctx.Request = ctx.Request.WithContext(logger.WithRequestID(ctx.Request.Context(), id))

		ctx.Next()
	}
}
