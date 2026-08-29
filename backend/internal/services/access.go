// Package services holds the business logic.
//
// Layer contract:
//   - A service owns its transaction boundary. Anything that writes more than one row does
//     so inside Db.Transaction.
//   - A service returns *response.ApplicationError, never a plain error, and never an HTTP
//     status code of its own choosing -- the error value carries it.
//   - A service maps gorm.ErrRecordNotFound onto a domain error, because only here is it
//     known whether a missing row is a 404 or an expected absence.
//   - A service never touches gin. Nothing in this package imports it.
package services

import (
	"time"

	"tablex/internal/config"
	"tablex/internal/db"
	"tablex/internal/logger"
	"tablex/internal/mailer"
	"tablex/internal/payments"
	"tablex/internal/realtime"
	"tablex/internal/repositories"
	"tablex/internal/storage"
	"tablex/internal/types"
)

// ServiceAccess holds the infrastructure every service needs.
type ServiceAccess struct {
	Cfg          *config.Config
	Db           *db.Store
	Logger       logger.Logger
	Repositories *repositories.Repositories
	// Payments resolves a provider by name (DECISIONS.md D2).
	Payments *payments.Registry
	// Storage holds dish photographs (DECISIONS.md D15). Never nil: a deployment with no
	// object store configured gets storage.NewUnconfigured(), which refuses writes and
	// resolves every key to "". That is what keeps "this deployment hosts no images" one
	// branch in the menu service rather than a nil check at every call site.
	Storage storage.Storage
	// Hub is nil when realtime is disabled in config. Every publish goes through
	// ServiceAccess.publish, which handles the nil, so no caller needs to check.
	Hub *realtime.Hub
	// Mailer sends transactional email. Never nil, on the same argument as Storage: a
	// deployment with no provider gets mailer.NewUnconfigured(), which refuses every send with
	// ErrNotConfigured. That keeps "this deployment cannot send email" one branch in the two
	// services that care rather than a nil check at every call site.
	Mailer mailer.Mailer
}

// publishOrderEvent sends a realtime event to the diner tracking this order and to the
// restaurant's admin panel, tolerating a disabled hub.
//
// Centralised so that realtime being off is a configuration choice rather than a branch in
// every service method, and so no code path can treat a publish failure as a reason to
// fail the request. Delivery is best-effort by design: the order is already committed and
// clients refetch authoritative state, so a lost event costs one polling interval and
// nothing else (DECISIONS.md D10).
//
// Always call this after the transaction commits, never inside it. Publishing from inside
// would announce a state that a rollback then discards, and the admin panel would show an
// order that does not exist.
func (a *ServiceAccess) publishOrderEvent(
	eventType types.EventType,
	restaurantUID, orderUID, status, tableLabel string,
) {
	if a.Hub == nil {
		return
	}
	a.Hub.PublishOrderEvent(restaurantUID, orderUID, types.Event{
		Type:       eventType,
		OrderUID:   orderUID,
		Status:     status,
		TableLabel: tableLabel,
		At:         time.Now().UTC(),
	})
}

// Services aggregates every business-logic object.
type Services struct {
	Auth       ServiceAuthMethods
	Restaurant ServiceRestaurantMethods
	Table      ServiceTableMethods
	Menu       ServiceMenuMethods
	Session    ServiceSessionMethods
	Order      ServiceOrderMethods
	Review     ServiceReviewMethods
	Payment    ServicePaymentMethods
	Stats      ServiceStatsMethods
	// Demo is the landing page's lead intake. Public and unauthenticated, and the only service
	// here that touches no restaurant at all.
	Demo ServiceDemoMethods
	// Platform is the operator surface. Constructed unconditionally, but only reachable
	// through the /api/platform/v1 group, which cmd/app mounts only when a platform token is
	// configured (DECISIONS.md D14).
	Platform ServicePlatformMethods
}

// NewServices wires every service against one shared Access.
func NewServices(
	cfg *config.Config,
	store *db.Store,
	log logger.Logger,
	repos *repositories.Repositories,
	providers *payments.Registry,
	objects storage.Storage,
	hub *realtime.Hub,
) *Services {
	access := &ServiceAccess{
		Cfg:          cfg,
		Db:           store,
		Logger:       log,
		Repositories: repos,
		Payments:     providers,
		Storage:      objects,
		Hub:          hub,
		// Built here rather than passed in from cmd/app, unlike Storage and Payments. Those two
		// have construction that can fail and a shape cmd/app already has to reason about; a
		// mailer is a URL and a key, and mailer.New falls back to the unconfigured one on its
		// own. Threading it through the boot sequence would add a parameter and decide nothing.
		Mailer: mailer.New(cfg.Email),
	}

	// Order and Payment are constructed in dependency order: settling a payment completes
	// an order, so Payment holds Order rather than the reverse.
	orderSvc := NewServiceOrder(access)

	return &Services{
		Auth:       NewServiceAuth(access),
		Restaurant: NewServiceRestaurant(access),
		Table:      NewServiceTable(access),
		Menu:       NewServiceMenu(access),
		Session:    NewServiceSession(access),
		Order:      orderSvc,
		Review:     NewServiceReview(access, orderSvc),
		Payment:    NewServicePayment(access, orderSvc),
		Stats:      NewServiceStats(access),
		Demo:       NewServiceDemo(access),
		Platform:   NewServicePlatform(access),
	}
}
