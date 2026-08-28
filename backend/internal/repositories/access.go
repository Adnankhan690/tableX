// Package repositories is the data-access layer.
//
// Layer contract, enforced by convention and checked in review:
//   - A repository does GORM and nothing else. No business rules, no validation, no
//     ApplicationErrors.
//   - It returns wrapped plain errors. Turning gorm.ErrRecordNotFound into "menu item not
//     found, 404" is the service's job, because only the service knows whether a missing
//     row is an error or an expected absence.
//   - Every method takes a context, and every tenant-scoped method takes a restaurantID.
//     Scoping is a parameter rather than ambient state so it cannot be forgotten
//     (DECISIONS.md D3).
//   - Methods that participate in a larger transaction take a *gorm.DB. Passing nil uses
//     the pool, so the same method serves both a standalone call and one inside a
//     transaction without a duplicate signature.
package repositories

import (
	"gorm.io/gorm"

	"tablex/internal/config"
	"tablex/internal/db"
	"tablex/internal/logger"
)

// RepositoryAccess holds the infrastructure every repository needs.
type RepositoryAccess struct {
	Cfg    *config.Config
	Db     *db.Store
	Logger logger.Logger
}

// conn resolves the handle to use: the supplied transaction, or the pool.
//
// This one helper is what lets every repository method be transaction-aware without
// doubling its API surface.
func (a *RepositoryAccess) conn(tx *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return a.Db.DB
}

// Shared query fragments. Named constants rather than inline strings so a typo is a
// compile-time problem in one place instead of a runtime failure in whichever query
// happens to be exercised.
const (
	whereID               = "id = ?"
	whereUID              = "uid = ?"
	whereRestaurantAndID  = "restaurant_id = ? AND id = ?"
	whereRestaurantAndUID = "restaurant_id = ? AND uid = ?"
	whereRestaurant       = "restaurant_id = ?"
	orderBySortThenName   = "sort_order ASC, name ASC"
	orderByPlacedDesc     = "placed_at DESC"
)

// Repositories aggregates every data-access object.
type Repositories struct {
	Restaurant    RepositoryRestaurantMethods
	Staff         RepositoryStaffMethods
	Table         RepositoryTableMethods
	Menu          RepositoryMenuMethods
	GuestSession  RepositoryGuestSessionMethods
	Order         RepositoryOrderMethods
	Review        RepositoryReviewMethods
	Payment       RepositoryPaymentMethods
	PasswordReset RepositoryPasswordResetMethods
}

// NewRepositories wires every repository against one shared Access.
func NewRepositories(cfg *config.Config, store *db.Store, log logger.Logger) *Repositories {
	access := &RepositoryAccess{Cfg: cfg, Db: store, Logger: log}

	return &Repositories{
		Restaurant:    NewRepositoryRestaurant(access),
		Staff:         NewRepositoryStaff(access),
		Table:         NewRepositoryTable(access),
		Menu:          NewRepositoryMenu(access),
		GuestSession:  NewRepositoryGuestSession(access),
		Order:         NewRepositoryOrder(access),
		Review:        NewRepositoryReview(access),
		Payment:       NewRepositoryPayment(access),
		PasswordReset: NewRepositoryPasswordReset(access),
	}
}
