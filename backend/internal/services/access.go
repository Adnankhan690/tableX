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
	"tablex/internal/payments"
	"tablex/internal/realtime"
	"tablex/internal/repositories"
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
	// Hub is nil when realtime is disabled in config. Every publish goes through
	// ServiceAccess.publish, which handles the nil, so no caller needs to check.
	Hub *realtime.Hub
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
	Payment    ServicePaymentMethods
	Stats      ServiceStatsMethods
}

// NewServices wires every service against one shared Access.
func NewServices(
	cfg *config.Config,
	store *db.Store,
	log logger.Logger,
	repos *repositories.Repositories,
	providers *payments.Registry,
	hub *realtime.Hub,
) *Services {
	access := &ServiceAccess{
		Cfg:          cfg,
		Db:           store,
		Logger:       log,
		Repositories: repos,
		Payments:     providers,
		Hub:          hub,
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
		Payment:    NewServicePayment(access, orderSvc),
		Stats:      NewServiceStats(access),
	}
}
