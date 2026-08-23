package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// ControllerScan handles the two QR entry points (DECISIONS.md D4).
type ControllerScan struct {
	Access *ControllerAccess
}

func NewControllerScan(access *ControllerAccess) *ControllerScan {
	return &ControllerScan{Access: access}
}

// ScanTable is the first request a diner's phone makes after scanning.
func (c *ControllerScan) ScanTable(ctx *gin.Context) {
	token := ctx.Param(PathParamQRToken)
	if token == "" {
		response.Send(ctx, nil, response.ErrInvalidParams)
		return
	}

	result, appErr := c.Access.Services.Session.ScanTable(
		ctx.Request.Context(), token, ctx.Request.UserAgent())
	response.Send(ctx, result, appErr)
}

// RestaurantLanding backs the restaurant-level fallback QR.
func (c *ControllerScan) RestaurantLanding(ctx *gin.Context) {
	result, appErr := c.Access.Services.Restaurant.GetPublicBySlug(
		ctx.Request.Context(), ctx.Param(PathParamSlug))
	response.Send(ctx, result, appErr)
}

// SelectTable claims a table from the fallback landing page.
func (c *ControllerScan) SelectTable(ctx *gin.Context) {
	var req types.RequestSelectTable
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Session.SelectTable(
		ctx.Request.Context(), ctx.Param(PathParamSlug), &req, ctx.Request.UserAgent())
	response.Send(ctx, result, appErr)
}
