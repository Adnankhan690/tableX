package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ControllerHealth serves the probes.
type ControllerHealth struct {
	Access *ControllerAccess
}

func NewControllerHealth(access *ControllerAccess) *ControllerHealth {
	return &ControllerHealth{Access: access}
}

// Live reports that the process is running, and checks nothing else.
//
// Deliberately no database ping. A liveness probe that fails on a database blip gets every
// application pod killed and restarted, turning a recoverable dependency outage into a total
// one -- and the restarted pods cannot connect either. Dependency health belongs in Ready.
func (c *ControllerHealth) Live(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Ready reports whether this instance can actually serve traffic.
//
// A 503 here takes the instance out of the load balancer without killing it, which is the
// correct response to a database that is briefly unreachable.
func (c *ControllerHealth) Ready(ctx *gin.Context) {
	body := gin.H{"status": "ok"}

	if c.Access.Hub != nil {
		body["realtime"] = c.Access.Hub.Stats()
	}

	if err := c.Access.Db.Ping(ctx.Request.Context()); err != nil {
		c.Access.Logger.With(ctx.Request.Context()).Errorf("[Ready] database unreachable: %+v", err)
		body["status"] = "degraded"
		body["database"] = "unreachable"
		ctx.JSON(http.StatusServiceUnavailable, body)
		return
	}

	body["database"] = "ok"
	ctx.JSON(http.StatusOK, body)
}
