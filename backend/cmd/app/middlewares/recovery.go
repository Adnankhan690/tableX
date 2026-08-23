package middlewares

import (
	"runtime/debug"

	"github.com/gin-gonic/gin"

	"tablex/internal/response"
)

// Recovery turns a panic into a 500 instead of a dropped connection.
//
// Installed outermost so it also catches a panic raised inside another middleware. The stack
// trace goes to the log and never to the client: a stack names internal paths, package
// layout and sometimes argument values, none of which an anonymous diner should receive.
func (m *Middlewares) Recovery() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				m.logger.With(ctx.Request.Context()).Errorf(
					"[Recovery] panic serving %s %s: %v\n%s",
					ctx.Request.Method, ctx.Request.URL.Path, recovered, debug.Stack())

				response.Send(ctx, nil, response.ErrInternal)
			}
		}()
		ctx.Next()
	}
}
