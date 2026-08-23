package app

import (
	"github.com/gin-gonic/gin"

	"tablex/internal/models"
)

// Three route groups, three trust levels. The prefix a route sits under is the whole
// statement of who may call it, so nothing is mounted outside one of these.
const (
	// PublicAPIV1 needs no credentials and is rate limited.
	PublicAPIV1 = "/api/public/v1"
	// GuestAPIV1 needs a guest session token (DECISIONS.md D5).
	GuestAPIV1 = "/api/guest/v1"
	// AdminAPIV1 needs a staff JWT, scoped to one restaurant (DECISIONS.md D3).
	AdminAPIV1 = "/api/admin/v1"
)

func (a *App) addRoutes(engine *gin.Engine) {
	a.addPublicRoutes(engine)
	a.addGuestRoutes(engine)
	a.addAdminRoutes(engine)
}

// addPublicRoutes mounts the anonymous surface.
//
// Everything here is reachable by anyone with the URL, so the group is deliberately tiny:
// the two health probes, the two QR entry points, and the payment webhook.
func (a *App) addPublicRoutes(engine *gin.Engine) {
	public := engine.Group(PublicAPIV1)

	// Probes are mounted before the rate limiter. A Kubernetes readiness check firing every
	// few seconds from a small set of node addresses would otherwise throttle itself and get
	// the pod removed from service.
	public.GET("/health/live", a.controllers.Health.Live)
	public.GET("/health/ready", a.controllers.Health.Ready)

	limited := public.Group("", a.middlewares.RateLimit())
	{
		// The QR scan. Rate limited because it is the one unauthenticated route that creates a
		// database row, and an unthrottled loop over it would fill guest_session.
		limited.GET("/t/:qr_token", a.controllers.Scan.ScanTable)
		limited.GET("/r/:slug", a.controllers.Scan.RestaurantLanding)
		limited.POST("/r/:slug/select-table", a.controllers.Scan.SelectTable)
	}

	// Webhooks are NOT rate limited. A gateway retrying a burst of settlements must not be
	// throttled into giving up -- dropping a payment confirmation is worse than serving the
	// requests. The endpoint's protection is HMAC verification, which happens before any
	// database work.
	public.POST("/webhooks/payments/:provider", a.controllers.Payment.HandleWebhook)
}

// addGuestRoutes mounts the diner surface. Every route requires a valid session token.
func (a *App) addGuestRoutes(engine *gin.Engine) {
	guest := engine.Group(GuestAPIV1, a.middlewares.GuestAuth(), a.middlewares.RateLimit())

	guest.GET("/menu", a.controllers.Menu.GetPublicMenu)

	// Placement carries the idempotency middleware; nothing else needs it, because nothing
	// else creates a row a double-tap could duplicate (DECISIONS.md D12).
	guest.POST("/orders", a.middlewares.Idempotency(), a.controllers.Order.PlaceOrder)
	guest.GET("/orders", a.controllers.Order.ListMyOrders)
	guest.GET("/orders/:uid", a.controllers.Order.GetMyOrder)
	guest.POST("/orders/:uid/cancel", a.controllers.Order.CancelMyOrder)

	guest.POST("/orders/:uid/payment", a.controllers.Payment.CreatePayment)
	guest.GET("/orders/:uid/payment", a.controllers.Payment.GetPaymentStatus)

	guest.GET("/orders/:uid/stream", a.controllers.Realtime.GuestStream)
}

// addAdminRoutes mounts the staff surface.
func (a *App) addAdminRoutes(engine *gin.Engine) {
	// login and refresh are mounted on their own group, without StaffAuth. They are the only
	// two admin routes that can be: everything else goes under the authenticated group below,
	// so adding a route there cannot accidentally leave it open.
	open := engine.Group(AdminAPIV1, a.middlewares.RateLimit())
	{
		open.POST("/auth/login", a.controllers.Auth.Login)
		open.POST("/auth/refresh", a.controllers.Auth.Refresh)
	}

	admin := engine.Group(AdminAPIV1, a.middlewares.StaffAuth())

	// Roles that may change the menu, tables, settings and staff. Floor staff are excluded:
	// they move orders through the kitchen, they do not reprice the menu mid-service.
	manager := a.middlewares.RequireRole(models.StaffRoleOwner, models.StaffRoleManager)
	owner := a.middlewares.RequireRole(models.StaffRoleOwner)

	admin.GET("/auth/me", a.controllers.Auth.Me)
	admin.POST("/auth/change-password", a.controllers.Auth.ChangePassword)

	admin.GET("/staff", a.controllers.Auth.ListStaff)
	admin.POST("/staff", owner, a.controllers.Auth.CreateStaff)
	admin.PATCH("/staff/:uid", owner, a.controllers.Auth.UpdateStaff)

	admin.GET("/settings", a.controllers.Settings.GetSettings)
	admin.PATCH("/settings", manager, a.controllers.Settings.UpdateSettings)

	admin.GET("/menu", a.controllers.Menu.GetAdminMenu)
	admin.POST("/menu/categories", manager, a.controllers.Menu.CreateCategory)
	admin.PATCH("/menu/categories/:uid", manager, a.controllers.Menu.UpdateCategory)
	admin.POST("/menu/items", manager, a.controllers.Menu.CreateItem)
	admin.PATCH("/menu/items/:uid", manager, a.controllers.Menu.UpdateItem)
	// Availability is open to every role, unlike the rest of menu management: marking a dish
	// sold out is a floor action taken mid-service, and routing it through a manager would
	// mean diners keep ordering something the kitchen ran out of.
	admin.PATCH("/menu/items/:uid/availability", a.controllers.Menu.SetAvailability)

	admin.GET("/tables", a.controllers.Table.ListTables)
	admin.POST("/tables", manager, a.controllers.Table.CreateTable)
	admin.POST("/tables/bulk", manager, a.controllers.Table.BulkCreateTables)
	admin.PATCH("/tables/:uid", manager, a.controllers.Table.UpdateTable)
	admin.GET("/tables/:uid/qr", a.controllers.Table.GetTableQR)
	admin.POST("/tables/:uid/qr/rotate", manager, a.controllers.Table.RotateTableQR)

	// Order handling is the core staff job, so every role can do all of it.
	admin.GET("/orders", a.controllers.Order.ListOrders)
	admin.GET("/orders/:uid", a.controllers.Order.GetOrder)
	admin.POST("/orders/:uid/transition", a.controllers.Order.TransitionOrder)
	admin.POST("/orders/:uid/items/:item_uid/cancel", a.controllers.Order.CancelOrderItem)

	// Confirming payment is available to every role because it is a counter action, and the
	// person on the till is often the one with the 'staff' role. It is attributable either
	// way: the actor is recorded on the settlement (DECISIONS.md D2).
	admin.POST("/orders/:uid/payment/confirm", a.controllers.Payment.ConfirmPayment)
	admin.POST("/orders/:uid/payment/fail", a.controllers.Payment.MarkPaymentFailed)

	admin.GET("/stats/today", a.controllers.Stats.Today)
	admin.GET("/stats/range", a.controllers.Stats.Range)

	admin.GET("/stream", a.controllers.Realtime.StaffStream)
}
