package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// ControllerAuth handles staff authentication and staff management.
type ControllerAuth struct {
	Access *ControllerAccess
}

func NewControllerAuth(access *ControllerAccess) *ControllerAuth {
	return &ControllerAuth{Access: access}
}

func (c *ControllerAuth) Login(ctx *gin.Context) {
	var req types.RequestStaffLogin
	if err := ctx.ShouldBindJSON(&req); err != nil {
		c.Access.Logger.With(ctx.Request.Context()).Warnf("[Login] bind: %v", err)
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Auth.Login(ctx.Request.Context(), &req)
	response.Send(ctx, result, appErr)
}

func (c *ControllerAuth) Refresh(ctx *gin.Context) {
	var req types.RequestRefreshToken
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Auth.Refresh(ctx.Request.Context(), &req)
	response.Send(ctx, result, appErr)
}

func (c *ControllerAuth) Me(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Auth.Me(ctx.Request.Context(), actor)
	response.Send(ctx, result, appErr)
}

func (c *ControllerAuth) ChangePassword(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestChangePassword
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	if appErr := c.Access.Services.Auth.ChangePassword(ctx.Request.Context(), actor, &req); appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}
	response.Send(ctx, nil, nil)
}

func (c *ControllerAuth) ListStaff(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Auth.ListStaff(ctx.Request.Context(), actor)
	response.Send(ctx, result, appErr)
}

func (c *ControllerAuth) CreateStaff(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestCreateStaff
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Auth.CreateStaff(ctx.Request.Context(), actor, &req)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}
	response.SendCreated(ctx, result)
}

func (c *ControllerAuth) UpdateStaff(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestUpdateStaff
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Auth.UpdateStaff(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), &req)
	response.Send(ctx, result, appErr)
}
