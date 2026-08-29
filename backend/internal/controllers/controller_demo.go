package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// ControllerDemo serves the public landing page's demo form.
type ControllerDemo struct {
	Access *ControllerAccess
}

func NewControllerDemo(access *ControllerAccess) *ControllerDemo {
	return &ControllerDemo{Access: access}
}

// BookDemo records a demo request.
//
// 201 rather than 200: it creates a durable row, and the landing page distinguishes "recorded"
// from the 409 that says the number already has one.
func (c *ControllerDemo) BookDemo(ctx *gin.Context) {
	var req types.RequestBookDemo
	if err := ctx.ShouldBindJSON(&req); err != nil {
		c.Access.Logger.With(ctx.Request.Context()).Warnf("[BookDemo] bind: %v", err)
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Demo.BookDemo(ctx.Request.Context(), &req)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}
	response.SendCreated(ctx, result)
}
