package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// ControllerReview handles the diner's rating write and the staff's reads of it.
type ControllerReview struct {
	Access *ControllerAccess
}

func NewControllerReview(access *ControllerAccess) *ControllerReview {
	return &ControllerReview{Access: access}
}

// RateMyOrderItem records one tap on one dish.
//
// A PUT rather than a POST, and that is the product decision showing through the verb: the
// diner rates with a single tap and there is no Submit button to press, so every tap is a
// complete request that must be safe to repeat. PUT says exactly that -- a double-tap on a
// stalled phone, or a correction from four stars to five, both resolve to the same row.
func (c *ControllerReview) RateMyOrderItem(ctx *gin.Context) {
	log := c.Access.Logger.With(ctx.Request.Context())

	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestRateOrderItem
	if err := ctx.ShouldBindJSON(&req); err != nil {
		log.Warnf("[RateMyOrderItem] bind: %v", err)
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Review.RateItem(
		ctx.Request.Context(), guest,
		ctx.Param(PathParamUID), ctx.Param(PathParamItemUID), &req)
	response.Send(ctx, result, appErr)
}

// ListReviews is the admin feed.
func (c *ControllerReview) ListReviews(ctx *gin.Context) {
	log := c.Access.Logger.With(ctx.Request.Context())

	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestListReviews
	if err := ctx.ShouldBindQuery(&req); err != nil {
		log.Warnf("[ListReviews] bind: %v", err)
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Review.ListForStaff(ctx.Request.Context(), actor, &req)
	response.Send(ctx, result, appErr)
}

// ReviewSummary is the reviews dashboard.
func (c *ControllerReview) ReviewSummary(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Review.SummaryForStaff(ctx.Request.Context(), actor)
	response.Send(ctx, result, appErr)
}
