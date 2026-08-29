package app

import (
	"context"

	"github.com/gin-gonic/gin"

	"tablex/internal/models"
)

// Four route groups, four trust levels. The prefix a route sits under is the whole
// statement of who may call it, so nothing is mounted outside one of these.
const (
	// PublicAPIV1 needs no credentials and is rate limited.
	PublicAPIV1 = "/api/public/v1"
	// GuestAPIV1 needs a guest session token (DECISIONS.md D5).
	GuestAPIV1 = "/api/guest/v1"
	// AdminAPIV1 needs a staff JWT, scoped to one restaurant (DECISIONS.md D3).
	AdminAPIV1 = "/api/admin/v1"
	// PlatformAPIV1 needs the deployment's platform token and is scoped to no restaurant --
	// it is what creates them (DECISIONS.md D14). Not mounted at all unless a token is
	// configured.
	PlatformAPIV1 = "/api/platform/v1"
)

func (a *App) addRoutes(engine *gin.Engine) {
	a.addPublicRoutes(engine)
	a.addGuestRoutes(engine)
	a.addAdminRoutes(engine)
	a.addPlatformRoutes(engine)
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

		// The QR gallery. Read-only and cacheable, but still rate limited: rendering a QR is
		// CPU work, and an unthrottled loop over it is a cheap way to spend the server's cycles.
		limited.GET("/restaurants", a.controllers.Scan.RestaurantDirectory)
		limited.GET("/r/:slug/qr", a.controllers.Scan.RestaurantQR)

		// The landing page's "Book a demo" form. The second unauthenticated route that creates a
		// row, so it is rate limited for the same reason the QR scan is -- and more so, because
		// this one sends an email as a side effect and an unthrottled loop over it would spend
		// the deployment's mail quota as well as its database.
		//
		// Public rather than platform, even though a lead is operator-facing once it lands: the
		// caller is a stranger on the open internet who has no credential of any kind, which is
		// exactly what this group means. What keeps it from being an open write surface is the
		// one-row-per-phone-number constraint behind it, not a token.
		limited.POST("/demo-requests", a.controllers.Demo.BookDemo)
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

	// Rating a dish. PUT, because the diner rates with one tap and no Submit button, so every
	// tap has to be safe to repeat -- a double-tap on a stalled phone and a correction from
	// four stars to five must both land on the same row (PRD 6.5).
	//
	// No idempotency middleware, unlike placement: that mechanism exists to stop a retry
	// creating a SECOND row, and this endpoint cannot create one. The unique index on
	// order_item_id is what guarantees it.
	guest.PUT("/orders/:uid/items/:item_uid/review", a.controllers.Review.RateMyOrderItem)

	// Rating the SERVICE. Addressed to an order, but what it writes is keyed to the session:
	// service is experienced once per sitting, not once per order (DECISIONS.md D17). The order in
	// the path is the warrant -- it is what proves this session owns something here and that the
	// review window is open -- rather than the subject of the rating.
	guest.PUT("/orders/:uid/service-review", a.controllers.Review.RateMyService)

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
		open.POST("/auth/forgot-password", a.controllers.Auth.ForgotPassword)
		open.POST("/auth/verify-reset-code", a.controllers.Auth.VerifyResetCode)
		open.POST("/auth/reset-password", a.controllers.Auth.ResetPassword)
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
	// Open/close is NOT manager-gated, unlike the rest of settings. Closing up is a floor action
	// taken by whoever is standing there at the end of service, and routing it through a manager
	// would mean orders keep arriving after the kitchen has gone home -- the same argument that
	// leaves menu availability open to every role (DECISIONS.md D18).
	admin.PATCH("/settings/accepting-orders", a.controllers.Settings.SetAcceptingOrders)

	admin.GET("/menu", a.controllers.Menu.GetAdminMenu)
	admin.POST("/menu/categories", manager, a.controllers.Menu.CreateCategory)
	admin.PATCH("/menu/categories/:uid", manager, a.controllers.Menu.UpdateCategory)
	admin.POST("/menu/items", manager, a.controllers.Menu.CreateItem)
	admin.PATCH("/menu/items/:uid", manager, a.controllers.Menu.UpdateItem)
	// Availability is open to every role, unlike the rest of menu management: marking a dish
	// sold out is a floor action taken mid-service, and routing it through a manager would
	// mean diners keep ordering something the kitchen ran out of.
	admin.PATCH("/menu/items/:uid/availability", a.controllers.Menu.SetAvailability)

	// Dish photographs (DECISIONS.md D15). Manager-gated with the rest of menu editing: a
	// photograph is the restaurant's public face, not a mid-service floor action.
	//
	// Upload is two calls because the bytes do not come through here. The first mints a
	// presigned URL and the browser PUTs straight to R2; the second is where the server
	// inspects what actually landed and attaches it. Nothing is mounted for the PUT itself --
	// that request never reaches this API.
	admin.POST("/menu/items/:uid/image/upload", manager, a.controllers.Menu.CreateImageUpload)
	admin.POST("/menu/items/:uid/image", manager, a.controllers.Menu.ConfirmImageUpload)
	admin.DELETE("/menu/items/:uid/image", manager, a.controllers.Menu.RemoveImage)

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

	// Reading reviews is open to every role. A complaint about a cold dish is most useful to
	// whoever is on the floor right now, and gating it behind a manager login is how it gets
	// read the next morning instead of while the table is still sitting there.
	admin.GET("/reviews", a.controllers.Review.ListReviews)
	// A separate route rather than a kind= filter on the one above. A service rating has no dish,
	// so sharing a response type would give every row three fields that are always empty in one of
	// the two cases, and a client that must know which case it is looking at before it can trust
	// any of them.
	admin.GET("/reviews/service", a.controllers.Review.ListServiceReviews)
	admin.GET("/reviews/summary", a.controllers.Review.ReviewSummary)

	admin.GET("/stats/today", a.controllers.Stats.Today)
	admin.GET("/stats/range", a.controllers.Stats.Range)

	admin.GET("/stream", a.controllers.Realtime.StaffStream)
}

// addPlatformRoutes mounts the operator surface, if this deployment has one.
//
// Absent a configured token the group is never registered, so onboarding answers 404 rather
// than 401 -- the same shape as the Razorpay adapter, which stays unregistered without
// credentials instead of failing at the point of use. A deployment that does not onboard
// tenants over HTTP therefore has no tenant-creating endpoint at all, which is a stronger
// guarantee than one guarded by a secret someone remembered to set.
func (a *App) addPlatformRoutes(engine *gin.Engine) {
	if !a.cfg.Platform.OnboardingEnabled() {
		a.logger.With(context.Background()).Infof(
			"[addPlatformRoutes] no platform token configured, %s not mounted -- "+
				"set TABLEX_PLATFORM_TOKEN to enable restaurant onboarding", PlatformAPIV1)
		return
	}

	// Rate limited as well as authenticated. The limiter is not the protection here -- the
	// token is -- but onboarding is the most expensive write in the system (a bcrypt hash plus
	// up to 200 QR tokens), so a loop over it with a valid token is worth bounding too.
	platform := engine.Group(PlatformAPIV1, a.middlewares.RateLimit(), a.middlewares.PlatformAuth())

	platform.POST("/restaurants", a.controllers.Platform.OnboardRestaurant)
	platform.GET("/restaurants", a.controllers.Platform.ListRestaurants)

	a.logger.With(context.Background()).Infof(
		"[addPlatformRoutes] %s mounted -- restaurant onboarding is enabled", PlatformAPIV1)
}
