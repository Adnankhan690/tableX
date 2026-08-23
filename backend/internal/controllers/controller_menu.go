package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// ControllerMenu serves both audiences, because they share one service.
type ControllerMenu struct {
	Access *ControllerAccess
}

func NewControllerMenu(access *ControllerAccess) *ControllerMenu {
	return &ControllerMenu{Access: access}
}

// GetPublicMenu serves the diner menu, scoped to the restaurant the guest session belongs
// to. The restaurant is never taken from the request -- it comes from the session, so a
// diner cannot ask for another restaurant's menu on their token.
func (c *ControllerMenu) GetPublicMenu(ctx *gin.Context) {
	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Menu.GetPublicMenu(ctx.Request.Context(), guest.RestaurantID)
	response.Send(ctx, result, appErr)
}

func (c *ControllerMenu) GetAdminMenu(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Menu.GetAdminMenu(ctx.Request.Context(), actor)
	response.Send(ctx, result, appErr)
}

func (c *ControllerMenu) CreateCategory(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestCreateCategory
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Menu.CreateCategory(ctx.Request.Context(), actor, &req)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}
	response.SendCreated(ctx, result)
}

func (c *ControllerMenu) UpdateCategory(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestUpdateCategory
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Menu.UpdateCategory(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), &req)
	response.Send(ctx, result, appErr)
}

func (c *ControllerMenu) CreateItem(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestCreateMenuItem
	if err := ctx.ShouldBindJSON(&req); err != nil {
		c.Access.Logger.With(ctx.Request.Context()).Warnf("[CreateItem] bind: %v", err)
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Menu.CreateItem(ctx.Request.Context(), actor, &req)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}
	response.SendCreated(ctx, result)
}

func (c *ControllerMenu) UpdateItem(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestUpdateMenuItem
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Menu.UpdateItem(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), &req)
	response.Send(ctx, result, appErr)
}

// SetAvailability is the one-tap sold-out toggle. Open to every staff role, unlike the rest
// of menu management: floor staff mark a dish unavailable mid-service but do not reprice it.
func (c *ControllerMenu) SetAvailability(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestSetAvailability
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Menu.SetAvailability(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), &req)
	response.Send(ctx, result, appErr)
}
