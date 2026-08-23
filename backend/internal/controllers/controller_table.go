package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// ControllerTable handles tables and their QR codes.
type ControllerTable struct {
	Access *ControllerAccess
}

func NewControllerTable(access *ControllerAccess) *ControllerTable {
	return &ControllerTable{Access: access}
}

func (c *ControllerTable) ListTables(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Table.List(ctx.Request.Context(), actor)
	response.Send(ctx, result, appErr)
}

func (c *ControllerTable) CreateTable(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestCreateTable
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Table.Create(ctx.Request.Context(), actor, &req)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}
	response.SendCreated(ctx, result)
}

func (c *ControllerTable) BulkCreateTables(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestBulkCreateTables
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Table.BulkCreate(ctx.Request.Context(), actor, &req)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}
	response.SendCreated(ctx, result)
}

func (c *ControllerTable) UpdateTable(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestUpdateTable
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Table.Update(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), &req)
	response.Send(ctx, result, appErr)
}

func (c *ControllerTable) GetTableQR(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	// A malformed size falls back rather than failing: it is a rendering hint, and rejecting
	// the request would stop a manager printing table cards over a typo in a query string.
	result, appErr := c.Access.Services.Table.GetQR(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), queryInt(ctx, "size", 512))
	response.Send(ctx, result, appErr)
}

func (c *ControllerTable) RotateTableQR(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Table.RotateQR(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID))
	response.Send(ctx, result, appErr)
}
