package controllers

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/response"
	"tablex/internal/types"
)

// ControllerOrder handles both the diner and the staff order endpoints.
type ControllerOrder struct {
	Access *ControllerAccess
}

func NewControllerOrder(access *ControllerAccess) *ControllerOrder {
	return &ControllerOrder{Access: access}
}

// PlaceOrder commits the order and then attaches a payment intent.
//
// This handler is where the order/payment dependency is resolved: the payment service
// depends on the order service, so the reverse cannot hold. The controller composes the two
// instead of either calling the other.
func (c *ControllerOrder) PlaceOrder(ctx *gin.Context) {
	log := c.Access.Logger.With(ctx.Request.Context())

	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestPlaceOrder
	if err := ctx.ShouldBindJSON(&req); err != nil {
		log.Warnf("[PlaceOrder] bind: %v", err)
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	idempotencyKey, _ := ctx.Get(CtxKeyIdempotencyKey)
	key, _ := idempotencyKey.(string)

	result, appErr := c.Access.Services.Order.Place(ctx.Request.Context(), guest, &req, key)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	// A payment row is created for EVERY order, not just the online ones. A counter order needs
	// one too: it is what gives staff a reference to quote and an auditable settlement to
	// confirm against later. Without it, "Mark as paid" has nothing to act on.
	//
	// The order is already committed and the kitchen has it, so from here on a failure must not
	// fail the response. Losing the order would be far worse than a missing payment intent, and
	// the diner can retry payment or simply pay at the counter. PRD 7 makes that trade explicit.
	payment, payErr := c.startPayment(ctx, result.Order.UID, result.Order.PaymentMethod)
	if payErr != nil {
		log.Errorf("[PlaceOrder] order %s committed but payment setup failed: %s",
			result.Order.UID, payErr.Error())
	} else {
		result.Payment = payment
	}

	response.SendCreated(ctx, result)
}

// startPayment asks the payment service to set up payment for a just-placed order.
//
// The method comes from the committed order rather than being assumed, so a counter order
// gets a counter payment row and an online order gets a UPI intent.
func (c *ControllerOrder) startPayment(
	ctx *gin.Context,
	orderUID, method string,
) (*types.PaymentView, *response.ApplicationError) {
	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		return nil, appErr
	}
	return c.Access.Services.Payment.CreateForOrder(
		ctx.Request.Context(), guest, orderUID,
		&types.RequestCreatePayment{Method: method})
}

func (c *ControllerOrder) GetMyOrder(ctx *gin.Context) {
	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Order.GetForGuest(
		ctx.Request.Context(), guest, ctx.Param(PathParamUID))
	response.Send(ctx, result, appErr)
}

func (c *ControllerOrder) ListMyOrders(ctx *gin.Context) {
	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Order.ListForGuest(ctx.Request.Context(), guest)
	response.Send(ctx, result, appErr)
}

func (c *ControllerOrder) CancelMyOrder(ctx *gin.Context) {
	guest, appErr := guestPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Order.CancelByGuest(
		ctx.Request.Context(), guest, ctx.Param(PathParamUID))
	response.Send(ctx, result, appErr)
}

// ListOrders is the admin queue. Filters bind from the query string.
func (c *ControllerOrder) ListOrders(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestListOrders
	if err := ctx.ShouldBindQuery(&req); err != nil {
		c.Access.Logger.With(ctx.Request.Context()).Warnf("[ListOrders] bind query: %v", err)
		response.Send(ctx, nil, response.ErrInvalidParams)
		return
	}

	result, appErr := c.Access.Services.Order.ListForStaff(ctx.Request.Context(), actor, &req)
	response.Send(ctx, result, appErr)
}

func (c *ControllerOrder) GetOrder(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	result, appErr := c.Access.Services.Order.GetForStaff(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID))
	response.Send(ctx, result, appErr)
}

// TransitionOrder moves an order through the lifecycle. A 409 from the service means another
// device got there first; the client refetches rather than retrying.
func (c *ControllerOrder) TransitionOrder(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestTransitionOrder
	if err := ctx.ShouldBindJSON(&req); err != nil {
		response.Send(ctx, nil, response.ErrInvalidRequest)
		return
	}

	result, appErr := c.Access.Services.Order.Transition(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), &req)
	response.Send(ctx, result, appErr)
}

func (c *ControllerOrder) CancelOrderItem(ctx *gin.Context) {
	actor, appErr := staffPrincipal(ctx)
	if appErr != nil {
		response.Send(ctx, nil, appErr)
		return
	}

	var req types.RequestCancelOrderItem
	// The body is optional here -- a reason is a courtesy on a single line, not a requirement
	// as it is on cancelling a whole order -- so a bind failure is tolerated.
	_ = ctx.ShouldBindJSON(&req)

	result, appErr := c.Access.Services.Order.CancelItem(
		ctx.Request.Context(), actor, ctx.Param(PathParamUID), ctx.Param(PathParamItemUID), &req)
	response.Send(ctx, result, appErr)
}
