package controllers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"tablex/internal/db"
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

	/*
		THE SCHEMA, not just the connection.

		A reachable database is not a usable one. A binary deployed ahead of its migrations starts
		fine, passes the ping above, is routed traffic, and then either 500s on the first query that
		touches a missing table -- which is how a missing `order_item_review` reached diners as a
		broken order screen -- or, worse, succeeds against a missing COLUMN and reads it as the zero
		value. `restaurant.accepting_orders` missing on its own would have made every restaurant
		read as closed and silently refused every order, with nothing in the logs.

		Failing readiness turns both into a deploy that never goes live: the platform routes on this
		probe, so the instance takes no traffic and the previous one keeps serving until somebody
		migrates -- at which point the next probe passes and it joins.

		The COUNT is public, the NAMES are logged. This endpoint is unauthenticated and column names
		describe the schema; whoever needs them has the logs.
	*/
	gaps, err := c.Access.Db.SchemaGaps(ctx.Request.Context())
	if err != nil {
		c.Access.Logger.With(ctx.Request.Context()).Errorf("[Ready] schema check failed: %+v", err)
		body["status"] = "degraded"
		body["schema"] = "unknown"
		ctx.JSON(http.StatusServiceUnavailable, body)
		return
	}
	if len(gaps) > 0 {
		c.Access.Logger.With(ctx.Request.Context()).Errorf(
			"[Ready] schema is behind this binary, refusing traffic -- run the migration. "+
				"%d gap(s): %s", len(gaps), db.SummariseGaps(gaps))
		body["status"] = "degraded"
		body["schema"] = fmt.Sprintf("%d gap(s); run the migration", len(gaps))
		ctx.JSON(http.StatusServiceUnavailable, body)
		return
	}

	body["schema"] = "ok"
	ctx.JSON(http.StatusOK, body)
}
