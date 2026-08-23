package controllers

import (
	"io"

	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// maxWebhookBody bounds what a webhook may send.
//
// An unbounded read on an unauthenticated endpoint is a trivial memory-exhaustion vector,
// and no legitimate gateway payload is anywhere near this size.
const maxWebhookBody = 1 << 20 // 1 MiB

// ControllerPayment handles payment intents, staff confirmation, and provider webhooks.
type ControllerPayment struct {
	Access *ControllerAccess
}

func NewControllerPayment(access *ControllerAccess) *ControllerPayment {
	return &ControllerPayment{Access: access}
}

func (c *ControllerPayment) CreatePayment(ctx *gin.Context) {
	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestCreatePayment
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Payment.CreateForOrder(
		ctx.Request.Context(), guest, ctx.Param(PathParamUID), &req)
	response.Send(ctx, result, appErr)
}

func (c *ControllerPayment) GetPaymentStatus(ctx *gin.Context) {
	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Payment.GetStatus(
		ctx.Request.Context(), guest, ctx.Param(PathParamUID))
	response.Send(ctx, result, appErr)
}

func (c *ControllerPayment) ConfirmPayment(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestConfirmPayment
	_ = ctx.ShouldBindJSON(&req)

	result, appErr := c.Access.Services.Payment.ConfirmByStaff(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), &req)
	response.Send(ctx, result, appErr)
}

func (c *ControllerPayment) MarkPaymentFailed(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestMarkPaymentFailed
	_ = ctx.ShouldBindJSON(&req)

	result, appErr := c.Access.Services.Payment.MarkFailedByStaff(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), &req)
	response.Send(ctx, result, appErr)
}

// HandleWebhook receives a provider callback.
//
// The only handler in the application that does not bind its body into a struct. The HMAC is
// computed over the exact bytes the provider sent, so binding and re-serialising would
// change them and break verification for every genuine event. The raw slice goes to the
// service untouched.
func (c *ControllerPayment) HandleWebhook(ctx *gin.Context) {
	log := c.Access.Logger.With(ctx.Request.Context())

	raw, err := io.ReadAll(io.LimitReader(ctx.Request.Body, maxWebhookBody))
	if err != nil {
		log.Errorf("[HandleWebhook] reading body: %v", err)
		response.Send(ctx, nil, response.ErrWebhookMalformed)
		return
	}

	// Flattened to the first value per key: signature headers are single-valued, and a
	// repeated one is either a misconfigured proxy or an attempt to confuse the lookup.
	headers := make(map[string]string, len(ctx.Request.Header))
	for name, values := range ctx.Request.Header {
		if len(values) > 0 {
			headers[name] = values[0]
		}
	}

	if appErr := c.Access.Services.Payment.HandleWebhook(
		ctx.Request.Context(), ctx.Param(PathParamProvider), raw, headers); appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	response.Send(ctx, nil, nil)
}
