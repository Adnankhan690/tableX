package repositories

import (
	"context"
	"time"

	"gorm.io/gorm"

	"tablex/internal/models"
)

// This file is the frozen data-access contract. Implementations live in repo_*.go.
//
// Every signature here takes a context first. Tenant-scoped reads take a restaurantID
// explicitly, so a query that forgets to scope itself does not compile rather than quietly
// returning another restaurant's rows (DECISIONS.md D3).

// RepositoryRestaurantMethods accesses the tenant root.
type RepositoryRestaurantMethods interface {
	Create(ctx context.Context, tx *gorm.DB, restaurant *models.Restaurant) error
	GetByID(ctx context.Context, id int32) (*models.Restaurant, error)
	GetByUID(ctx context.Context, uid string) (*models.Restaurant, error)
	// GetBySlug backs the restaurant-level fallback QR, /r/{slug} (DECISIONS.md D4).
	GetBySlug(ctx context.Context, slug string) (*models.Restaurant, error)
	UpdateFields(ctx context.Context, id int32, fields map[string]any) (*models.Restaurant, error)
	SlugExists(ctx context.Context, slug string, excludeID int32) (bool, error)
	List(ctx context.Context) ([]*models.Restaurant, error)
}

// RepositoryStaffMethods accesses admin logins.
type RepositoryStaffMethods interface {
	Create(ctx context.Context, tx *gorm.DB, staff *models.StaffUser) error
	// GetByEmail is scoped by restaurant because email is unique per tenant, not globally:
	// the same person may staff two unrelated restaurants on this platform.
	GetByEmail(ctx context.Context, restaurantID int32, email string) (*models.StaffUser, error)
	// GetByEmailAnyRestaurant backs login, where the caller has an email but not yet a
	// restaurant. It returns every match so the service can reject an ambiguous login
	// rather than silently signing the user into whichever row came first.
	GetByEmailAnyRestaurant(ctx context.Context, email string) ([]*models.StaffUser, error)
	GetByUID(ctx context.Context, restaurantID int32, uid string) (*models.StaffUser, error)
	GetByID(ctx context.Context, id int32) (*models.StaffUser, error)
	ListByRestaurant(ctx context.Context, restaurantID int32) ([]*models.StaffUser, error)
	UpdateFields(ctx context.Context, id int32, fields map[string]any) (*models.StaffUser, error)
	TouchLastLogin(ctx context.Context, id int32, at time.Time) error
	CountByRole(ctx context.Context, restaurantID int32, role models.StaffRole) (int64, error)
}

// RepositoryTableMethods accesses physical tables and their QR tokens.
type RepositoryTableMethods interface {
	Create(ctx context.Context, tx *gorm.DB, table *models.RestaurantTable) error
	// CreateBatch inserts a numbered range in one statement, for onboarding a floor.
	CreateBatch(ctx context.Context, tx *gorm.DB, tables []*models.RestaurantTable) error
	GetByID(ctx context.Context, restaurantID, id int32) (*models.RestaurantTable, error)
	GetByUID(ctx context.Context, restaurantID int32, uid string) (*models.RestaurantTable, error)
	// GetByQRToken resolves a scanned QR. Not restaurant-scoped, because the token is what
	// identifies the restaurant -- that is the whole point of the scan.
	GetByQRToken(ctx context.Context, qrToken string) (*models.RestaurantTable, error)
	ListByRestaurant(ctx context.Context, restaurantID int32, includeInactive bool) ([]*models.RestaurantTable, error)
	UpdateFields(ctx context.Context, id int32, fields map[string]any) (*models.RestaurantTable, error)
	LabelExists(ctx context.Context, restaurantID int32, label string, excludeID int32) (bool, error)
	// CountLiveOrders backs the admin floor view and blocks archiving a table mid-service.
	CountLiveOrders(ctx context.Context, restaurantID int32, statuses []models.OrderStatus) (map[int32]int64, error)
}

// RepositoryMenuMethods accesses categories and items.
type RepositoryMenuMethods interface {
	CreateCategory(ctx context.Context, tx *gorm.DB, category *models.MenuCategory) error
	GetCategoryByID(ctx context.Context, restaurantID, id int32) (*models.MenuCategory, error)
	GetCategoryByUID(ctx context.Context, restaurantID int32, uid string) (*models.MenuCategory, error)
	ListCategories(ctx context.Context, restaurantID int32, includeInactive bool) ([]*models.MenuCategory, error)
	UpdateCategoryFields(ctx context.Context, id int32, fields map[string]any) (*models.MenuCategory, error)
	CategoryNameExists(ctx context.Context, restaurantID int32, name string, excludeID int32) (bool, error)
	CountItemsInCategory(ctx context.Context, categoryID int32, includeArchived bool) (int64, error)

	CreateItem(ctx context.Context, tx *gorm.DB, item *models.MenuItem) error
	GetItemByID(ctx context.Context, restaurantID, id int32) (*models.MenuItem, error)
	GetItemByUID(ctx context.Context, restaurantID int32, uid string) (*models.MenuItem, error)
	// GetItemsByUIDs resolves a whole cart in one query.
	//
	// One query, not one per line: pricing an order must not issue N round trips, and it
	// must see all items at a single point in time so a mid-checkout price edit cannot
	// apply to half the cart.
	GetItemsByUIDs(ctx context.Context, tx *gorm.DB, restaurantID int32, uids []string) ([]*models.MenuItem, error)
	ListItems(ctx context.Context, restaurantID int32, includeInactive bool) ([]*models.MenuItem, error)
	UpdateItemFields(ctx context.Context, id int32, fields map[string]any) (*models.MenuItem, error)
	ItemNameExists(ctx context.Context, restaurantID, categoryID int32, name string, excludeID int32) (bool, error)
	SetAvailability(ctx context.Context, restaurantID, id int32, available bool) (*models.MenuItem, error)
	// AdjustRating moves a dish's review aggregate by a delta, as a single UPDATE with the
	// arithmetic expressed in SQL.
	//
	// A delta rather than a computed absolute, and SQL rather than Go, because the obvious
	// alternative -- read the counters, add in Go, write them back -- is a read-modify-write.
	// Two diners rating the same dish in the same second would each read the same starting
	// value and one increment would vanish. Expressed this way the database serialises the
	// two updates and both land.
	//
	// Takes a tx because it is only ever correct inside the transaction that wrote the
	// review: a committed review whose counters did not move is a permanently wrong average
	// with nothing to point at.
	AdjustRating(ctx context.Context, tx *gorm.DB, menuItemID int32, countDelta int, sumDelta int64) error
}

// RepositoryGuestSessionMethods accesses anonymous diner sessions (DECISIONS.md D5).
type RepositoryGuestSessionMethods interface {
	Create(ctx context.Context, tx *gorm.DB, session *models.GuestSession) error
	GetByToken(ctx context.Context, token string) (*models.GuestSession, error)
	GetByUID(ctx context.Context, uid string) (*models.GuestSession, error)
	Extend(ctx context.Context, id int32, expiresAt time.Time) error
	// DeleteExpired reaps stale rows. Returns the count so the caller can log it.
	DeleteExpired(ctx context.Context, before time.Time) (int64, error)
}

// OrderListFilter is the admin queue's query (PRD 6.6).
type OrderListFilter struct {
	RestaurantID int32
	// Statuses is an OR set. Empty means every status.
	Statuses      []models.OrderStatus
	TableID       *int32
	PaymentStatus *models.PaymentStatus
	// Search matches an order number or customer name.
	Search string
	From   *time.Time
	To     *time.Time
	Offset int
	Limit  int
}

// OrderStats is the dashboard aggregate, keyed to the PRD's throughput metrics (PRD 3).
type OrderStats struct {
	OrdersPlaced    int64
	OrdersCompleted int64
	OrdersCancelled int64
	OrdersLive      int64
	RevenueMinor    int64
	UnpaidMinor     int64
	// AvgAcceptSecs is the PRD's order-taking-time metric, measured from placement to
	// acceptance. Nil when no order in range was accepted.
	AvgAcceptSecs *int64
	// AvgFulfilSecs is placement to completion.
	AvgFulfilSecs *int64
}

// RepositoryOrderMethods accesses orders, their items, and the status log.
type RepositoryOrderMethods interface {
	// Create inserts the order and its items. Called inside the placement transaction.
	Create(ctx context.Context, tx *gorm.DB, order *models.Order) error
	GetByID(ctx context.Context, restaurantID, id int32) (*models.Order, error)
	// GetByUID loads an order with its items and timeline.
	GetByUID(ctx context.Context, restaurantID int32, uid string) (*models.Order, error)
	// GetByUIDAnyRestaurant backs the diner's tracking screen, where the caller holds a
	// guest token and an order uid but no restaurant scope. The service verifies the
	// session owns the order (DECISIONS.md D5).
	GetByUIDAnyRestaurant(ctx context.Context, uid string) (*models.Order, error)
	// GetByIdempotencyKey resolves a retried checkout to the order it already created
	// (DECISIONS.md D12).
	GetByIdempotencyKey(ctx context.Context, tx *gorm.DB, restaurantID int32, key string) (*models.Order, error)
	// LockForUpdate re-reads an order inside a transaction, taking a row lock under
	// Postgres. This is what makes concurrent accept-and-cancel resolve to exactly one
	// winner instead of both succeeding (DECISIONS.md D1, D6).
	LockForUpdate(ctx context.Context, tx *gorm.DB, restaurantID int32, uid string) (*models.Order, error)
	List(ctx context.Context, filter OrderListFilter) ([]*models.Order, int64, error)
	ListByGuestSession(ctx context.Context, sessionID int32) ([]*models.Order, error)
	UpdateFields(ctx context.Context, tx *gorm.DB, id int32, fields map[string]any) error
	// AppendStatusEvent writes one row to the append-only transition log.
	AppendStatusEvent(ctx context.Context, tx *gorm.DB, event *models.OrderStatusEvent) error
	ListStatusEvents(ctx context.Context, orderID int32) ([]*models.OrderStatusEvent, error)
	GetItemByUID(ctx context.Context, tx *gorm.DB, orderID int32, uid string) (*models.OrderItem, error)
	UpdateItemFields(ctx context.Context, tx *gorm.DB, id int32, fields map[string]any) error
	ListItems(ctx context.Context, orderID int32) ([]*models.OrderItem, error)
	// NextOrderNumber allocates the daily human-readable number under a row lock
	// (DECISIONS.md D9). Must be called inside a transaction.
	NextOrderNumber(ctx context.Context, tx *gorm.DB, restaurantID int32, businessDate time.Time) (int, error)
	Stats(ctx context.Context, restaurantID int32, from, to time.Time) (*OrderStats, error)
}

// ReviewListFilter is the admin reviews feed's query.
type ReviewListFilter struct {
	RestaurantID int32
	// MenuItemID is 0 for "every dish", which is how the unfiltered feed asks.
	MenuItemID int32
	// MinRating and MaxRating are inclusive bounds, 0 meaning unbounded on that side.
	MinRating int
	MaxRating int
	// HasComment narrows to reviews carrying prose.
	HasComment bool
	From       *time.Time
	To         *time.Time
	Offset     int
	Limit      int
}

// RatingAggregate is one dish's rolled-up score, as the ranking query returns it.
type RatingAggregate struct {
	MenuItemID int32
	Count      int64
	Sum        int64
}

// ReviewDistribution counts reviews at each point of the scale, indexed 0..4 for 1..5 stars.
type ReviewDistribution [5]int64

// RepositoryReviewMethods accesses dish ratings.
type RepositoryReviewMethods interface {
	// GetByOrderItemID resolves the one review a line may carry. Takes a tx because the
	// upsert must read its own transaction's writes to compute the aggregate delta -- reading
	// through the pool there would miss them and double-count.
	GetByOrderItemID(ctx context.Context, tx *gorm.DB, orderItemID int32) (*models.OrderItemReview, error)
	Create(ctx context.Context, tx *gorm.DB, review *models.OrderItemReview) error
	// UpdateFields patches an existing review in place, so a diner correcting a mis-tap
	// updates rather than accumulates.
	UpdateFields(ctx context.Context, tx *gorm.DB, id int32, fields map[string]any) error
	// ListByOrder loads every review on one order, for the diner's own tracking screen.
	ListByOrder(ctx context.Context, orderID int32) ([]*models.OrderItemReview, error)
	// List backs the admin feed, joined to the order line for the dish name the diner
	// actually saw and to the order for its number.
	List(ctx context.Context, filter ReviewListFilter) ([]*models.OrderItemReview, int64, error)
	// Distribution counts one restaurant's reviews at each star, in a single pass.
	Distribution(ctx context.Context, restaurantID int32) (ReviewDistribution, int64, int64, error)

	// --- Service ratings (DECISIONS.md D17) ---
	//
	// Session-scoped rather than order-scoped: service is experienced once per sitting.

	// GetServiceBySession resolves the one service review a session may carry. Takes a tx for the
	// same reason GetByOrderItemID does -- the upsert must see its own transaction's write.
	GetServiceBySession(ctx context.Context, tx *gorm.DB, sessionID int32) (*models.ServiceReview, error)
	CreateService(ctx context.Context, tx *gorm.DB, review *models.ServiceReview) error
	UpdateServiceFields(ctx context.Context, tx *gorm.DB, id int32, fields map[string]any) error
	// ListService backs the admin service feed.
	ListService(ctx context.Context, filter ServiceReviewListFilter) ([]*models.ServiceReview, int64, error)
	// ServiceDistribution counts one restaurant's service ratings at each star.
	//
	// Computed on read, with NO denormalised counterpart to menu_item.rating_count. The asymmetry
	// is deliberate: those counters exist because the diner menu is the hottest read in the
	// product, while this is one admin screen over one tenant's rows.
	ServiceDistribution(ctx context.Context, restaurantID int32) (ReviewDistribution, int64, int64, error)
}

// ServiceReviewListFilter is the admin service feed's query.
type ServiceReviewListFilter struct {
	RestaurantID int32
	MinRating    int
	MaxRating    int
	HasComment   bool
	From         *time.Time
	To           *time.Time
	Offset       int
	Limit        int
}

// RepositoryPaymentMethods accesses payments and the webhook ledger.
type RepositoryPaymentMethods interface {
	Create(ctx context.Context, tx *gorm.DB, payment *models.Payment) error
	GetByID(ctx context.Context, restaurantID, id int32) (*models.Payment, error)
	GetByUID(ctx context.Context, restaurantID int32, uid string) (*models.Payment, error)
	// GetByReference resolves a webhook back to our payment row. Not restaurant-scoped,
	// because a webhook arrives with no tenant context -- the reference is globally unique.
	GetByReference(ctx context.Context, tx *gorm.DB, reference string) (*models.Payment, error)
	// LockForUpdate re-reads a payment inside a transaction with a row lock, so a webhook
	// and a staff confirmation racing on the same payment cannot both settle it.
	LockForUpdate(ctx context.Context, tx *gorm.DB, id int32) (*models.Payment, error)
	ListByOrder(ctx context.Context, orderID int32) ([]*models.Payment, error)
	UpdateFields(ctx context.Context, tx *gorm.DB, id int32, fields map[string]any) error
	// RecordWebhookEvent inserts into the idempotency ledger. It returns false when the
	// event was already recorded, which is how a redelivery is detected without a
	// separate read -- the unique index does the work (DECISIONS.md D2).
	RecordWebhookEvent(ctx context.Context, tx *gorm.DB, event *models.PaymentWebhookEvent) (bool, error)
	MarkWebhookProcessed(ctx context.Context, tx *gorm.DB, id int64, at time.Time, errMsg string) error
}

// RepositoryDemoRequestMethods accesses demo requests from the landing page.
//
// The one repository with no restaurantID on any method, because the row exists precisely
// because the restaurant does not yet (models.DemoRequest).
type RepositoryDemoRequestMethods interface {
	// Create inserts a lead. Returns the driver's error unchanged on a uniqueness rejection so
	// the service can tell "this number already booked" apart from a real failure -- see
	// IsUniqueViolation.
	Create(ctx context.Context, req *models.DemoRequest) error
	// GetByPhone returns (nil, nil) when no demo has been booked against the number.
	GetByPhone(ctx context.Context, phone string) (*models.DemoRequest, error)
}

// RepositoryPasswordResetMethods accesses password reset codes.
type RepositoryPasswordResetMethods interface {
	CreateCode(ctx context.Context, resetCode *models.PasswordResetCode) error
	GetActiveCode(ctx context.Context, email string, code string) (*models.PasswordResetCode, error)
	MarkCodeUsed(ctx context.Context, id int32) error
	GetLastActiveCode(ctx context.Context, email string) (*models.PasswordResetCode, error)
}
