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

// RestaurantDirectory lists the restaurants taking orders (DECISIONS.md D13).
//
// Backs the /qr gallery in the diner app, which has no credentials of any kind -- so this has to
// be public or the page could not exist.
func (c *ControllerScan) RestaurantDirectory(ctx *gin.Context) {
	result, appErr := c.Access.Services.Restaurant.ListPublic(ctx.Request.Context())
	response.Send(ctx, result, appErr)
}

// RestaurantQR renders a restaurant's QR code for its table-picker landing page.
//
// A malformed size falls back rather than failing: it is a rendering hint, and a typo in a query
// string should not stop the page loading.
func (c *ControllerScan) RestaurantQR(ctx *gin.Context) {
	result, appErr := c.Access.Services.Restaurant.GetPublicQR(
		ctx.Request.Context(), ctx.Param(PathParamSlug), queryInt(ctx, "size", 320))
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
