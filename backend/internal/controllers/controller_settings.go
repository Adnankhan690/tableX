package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// ControllerSettings handles restaurant configuration.
type ControllerSettings struct {
	Access *ControllerAccess
}

func NewControllerSettings(access *ControllerAccess) *ControllerSettings {
	return &ControllerSettings{Access: access}
}

func (c *ControllerSettings) GetSettings(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Restaurant.GetSettings(ctx.Request.Context(), actor)
	response.Send(ctx, result, appErr)
}

func (c *ControllerSettings) UpdateSettings(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestUpdateRestaurant
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Restaurant.UpdateSettings(ctx.Request.Context(), actor, &req)
	response.Send(ctx, result, appErr)
}

// SetAcceptingOrders flips the "we are open" switch (DECISIONS.md D18).
//
// A dedicated handler rather than a field on UpdateSettings, matching Menu.SetAvailability: closing
// up mid-service must not carry along whatever else a settings form left in its state.
func (c *ControllerSettings) SetAcceptingOrders(ctx *gin.Context) {
	log := c.Access.Logger.With(ctx.Request.Context())

	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestSetAcceptingOrders
	if err := ctx.ShouldBindJSON(&req); err != nil {
		log.Warnf("[SetAcceptingOrders] bind: %v", err)
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Restaurant.SetAcceptingOrders(ctx.Request.Context(), actor, &req)
	response.Send(ctx, result, appErr)
}
