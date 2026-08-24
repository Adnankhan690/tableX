package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// ControllerPlatform handles the operator surface: creating tenants (DECISIONS.md D14).
//
// The only controller with no principal to resolve. Authorisation happened in
// middlewares.PlatformAuth, which compares a shared secret -- there is no identity to pass
// down, because a staff login belongs to exactly one restaurant and cannot describe an
// operator acting across all of them (DECISIONS.md D3).
type ControllerPlatform struct {
	Access *ControllerAccess
}

func NewControllerPlatform(access *ControllerAccess) *ControllerPlatform {
	return &ControllerPlatform{Access: access}
}

// OnboardRestaurant creates a restaurant, its owner login and optionally its tables.
//
// 201 rather than 200: this creates rows, and the response carries the QR URLs of the tables it
// created. Everything the operator needs to hand the restaurant over is in one body.
func (c *ControllerPlatform) OnboardRestaurant(ctx *gin.Context) {
	var req types.RequestOnboardRestaurant
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Platform.OnboardRestaurant(ctx.Request.Context(), &req)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}
	response.SendCreated(ctx, result)
}

// ListRestaurants returns every tenant on the deployment, inactive ones included.
func (c *ControllerPlatform) ListRestaurants(ctx *gin.Context) {
	result, appErr := c.Access.Services.Platform.ListRestaurants(ctx.Request.Context())
	response.Send(ctx, result, appErr)
}
