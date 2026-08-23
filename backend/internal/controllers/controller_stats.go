package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
)

// ControllerStats serves the admin dashboard figures (PRD 3).
type ControllerStats struct {
	Access *ControllerAccess
}

func NewControllerStats(access *ControllerAccess) *ControllerStats {
	return &ControllerStats{Access: access}
}

func (c *ControllerStats) Today(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Stats.Today(ctx.Request.Context(), actor)
	response.Send(ctx, result, appErr)
}

func (c *ControllerStats) Range(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	// Validation of the date format lives in the service, which also knows the restaurant's
	// timezone -- parsing here would either duplicate that or get the zone wrong.
	result, appErr := c.Access.Services.Stats.Range(
		ctx.Request.Context(), actor, ctx.Query("from"), ctx.Query("to"))
	response.Send(ctx, result, appErr)
}
