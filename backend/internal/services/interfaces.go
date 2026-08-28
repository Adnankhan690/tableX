package services

import (
	"context"

	"tablex/internal/models"
	"tablex/internal/response"
	"tablex/internal/types"
)

// This file is the frozen business-logic contract. Implementations live in service_*.go.
//
// Every method returns (*T, *response.ApplicationError). The pair is deliberate: a nil
// error with a nil result is never valid, and the error type already carries the HTTP
// status, so a controller has nothing left to decide.

// StaffPrincipal is the authenticated caller, resolved from a JWT by the auth middleware
// and passed down explicitly.
//
// Explicit rather than pulled from a context inside each service: a service that reads
// ambient identity is one that can be called from a background job with no identity and
// fail at runtime. Passing it in makes the requirement visible in the signature.
type StaffPrincipal struct {
	StaffID      int32
	StaffUID     string
	RestaurantID int32
	// RestaurantUID is carried so realtime publishes need no extra lookup.
	RestaurantUID string
	Role          models.StaffRole
}

// GuestPrincipal is the anonymous diner, resolved from a session token (DECISIONS.md D5).
type GuestPrincipal struct {
	SessionID     int32
	SessionUID    string
	RestaurantID  int32
	RestaurantUID string
	TableID       int32
	TableLabel    string
}

// ServiceAuthMethods handles staff authentication.
type ServiceAuthMethods interface {
	Login(ctx context.Context, req *types.RequestStaffLogin) (*types.ResponseStaffLogin, *response.ApplicationError)
	Refresh(ctx context.Context, req *types.RequestRefreshToken) (*types.ResponseRefreshToken, *response.ApplicationError)
	// Authenticate validates a bearer token. Called by middleware on every protected route,
	// so it must not hit the database on the happy path -- the claims carry what is needed.
	Authenticate(ctx context.Context, bearer string) (*StaffPrincipal, *response.ApplicationError)
	CreateStaff(ctx context.Context, actor *StaffPrincipal, req *types.RequestCreateStaff) (*types.StaffMember, *response.ApplicationError)
	UpdateStaff(ctx context.Context, actor *StaffPrincipal, uid string, req *types.RequestUpdateStaff) (*types.StaffMember, *response.ApplicationError)
	ListStaff(ctx context.Context, actor *StaffPrincipal) (*types.ResponseStaffList, *response.ApplicationError)
	ChangePassword(ctx context.Context, actor *StaffPrincipal, req *types.RequestChangePassword) *response.ApplicationError
	Me(ctx context.Context, actor *StaffPrincipal) (*types.StaffMember, *response.ApplicationError)
	ForgotPassword(ctx context.Context, email string) *response.ApplicationError
	VerifyResetCode(ctx context.Context, email string, code string) *response.ApplicationError
	ResetPassword(ctx context.Context, email string, code string, newPassword string) *response.ApplicationError
}

// ServiceRestaurantMethods handles restaurant settings.
type ServiceRestaurantMethods interface {
	GetSettings(ctx context.Context, actor *StaffPrincipal) (*types.RestaurantSettings, *response.ApplicationError)
	UpdateSettings(ctx context.Context, actor *StaffPrincipal, req *types.RequestUpdateRestaurant) (*types.RestaurantSettings, *response.ApplicationError)
	// GetPublicBySlug backs the restaurant-level fallback QR (DECISIONS.md D4).
	GetPublicBySlug(ctx context.Context, slug string) (*types.ResponseRestaurantLanding, *response.ApplicationError)
	// ListPublic lists the restaurants currently taking orders (DECISIONS.md D13).
	ListPublic(ctx context.Context) (*types.ResponseRestaurantDirectory, *response.ApplicationError)
	// GetPublicQR renders a restaurant's own QR code, encoding its /r/{slug} landing page.
	GetPublicQR(ctx context.Context, slug string, size int) (*types.RestaurantQRView, *response.ApplicationError)
}

// ServiceTableMethods handles tables and their QR codes.
type ServiceTableMethods interface {
	List(ctx context.Context, actor *StaffPrincipal) (*types.ResponseTableList, *response.ApplicationError)
	Create(ctx context.Context, actor *StaffPrincipal, req *types.RequestCreateTable) (*types.TableInfo, *response.ApplicationError)
	BulkCreate(ctx context.Context, actor *StaffPrincipal, req *types.RequestBulkCreateTables) (*types.ResponseTableList, *response.ApplicationError)
	Update(ctx context.Context, actor *StaffPrincipal, uid string, req *types.RequestUpdateTable) (*types.TableInfo, *response.ApplicationError)
	// GetQR renders a table's printable QR code.
	GetQR(ctx context.Context, actor *StaffPrincipal, uid string, size int) (*types.ResponseTableQR, *response.ApplicationError)
	// RotateQR issues a new token, invalidating the printed sticker. The recovery path for
	// a QR that leaked online (DECISIONS.md D4).
	RotateQR(ctx context.Context, actor *StaffPrincipal, uid string) (*types.ResponseTableQR, *response.ApplicationError)
}

// ServiceMenuMethods handles the catalogue.
type ServiceMenuMethods interface {
	// GetPublicMenu is the diner menu: the whole thing in one response (PRD 6.2, PRD 7).
	GetPublicMenu(ctx context.Context, restaurantID int32) (*types.ResponseMenu, *response.ApplicationError)
	GetAdminMenu(ctx context.Context, actor *StaffPrincipal) (*types.ResponseAdminMenu, *response.ApplicationError)

	CreateCategory(ctx context.Context, actor *StaffPrincipal, req *types.RequestCreateCategory) (*types.AdminMenuCategoryView, *response.ApplicationError)
	UpdateCategory(ctx context.Context, actor *StaffPrincipal, uid string, req *types.RequestUpdateCategory) (*types.AdminMenuCategoryView, *response.ApplicationError)

	CreateItem(ctx context.Context, actor *StaffPrincipal, req *types.RequestCreateMenuItem) (*types.AdminMenuItemView, *response.ApplicationError)
	UpdateItem(ctx context.Context, actor *StaffPrincipal, uid string, req *types.RequestUpdateMenuItem) (*types.AdminMenuItemView, *response.ApplicationError)
	// SetAvailability is the one-tap sold-out toggle staff use mid-service.
	SetAvailability(ctx context.Context, actor *StaffPrincipal, uid string, req *types.RequestSetAvailability) (*types.AdminMenuItemView, *response.ApplicationError)

	// CreateImageUpload mints a presigned URL the browser PUTs one photograph to directly,
	// so the bytes never pass through this API (DECISIONS.md D15).
	CreateImageUpload(ctx context.Context, actor *StaffPrincipal, uid string, req *types.RequestCreateImageUpload) (*types.ResponseImageUpload, *response.ApplicationError)
	// ConfirmImageUpload attaches a finished upload to the dish, after checking what
	// actually landed in the bucket. This is the enforcement point, not CreateImageUpload:
	// only here is there an object to measure and sniff.
	ConfirmImageUpload(ctx context.Context, actor *StaffPrincipal, uid string, req *types.RequestConfirmImageUpload) (*types.AdminMenuItemView, *response.ApplicationError)
	// RemoveImage clears a dish's photograph and deletes the object if we hosted it.
	//
	// Works on a deployment whose storage configuration has gone away, deliberately: a row
	// pointing at bytes nobody can serve must always be clearable.
	RemoveImage(ctx context.Context, actor *StaffPrincipal, uid string) (*types.AdminMenuItemView, *response.ApplicationError)
}

// ServiceSessionMethods handles the QR scan and guest sessions (DECISIONS.md D4, D5).
type ServiceSessionMethods interface {
	// ScanTable resolves a QR token into a session plus the whole menu, in one response.
	// This is the first thing that happens after a scan and it sets the impression of how
	// fast the product is.
	ScanTable(ctx context.Context, qrToken, userAgent string) (*types.ResponseScanTable, *response.ApplicationError)
	// SelectTable claims a table from the restaurant-level fallback landing page.
	SelectTable(ctx context.Context, slug string, req *types.RequestSelectTable, userAgent string) (*types.ResponseScanTable, *response.ApplicationError)
	// Authenticate validates a guest bearer token. Called by middleware on diner routes.
	Authenticate(ctx context.Context, token string) (*GuestPrincipal, *response.ApplicationError)
}

// ServiceOrderMethods handles the order lifecycle (DECISIONS.md D1).
type ServiceOrderMethods interface {
	// Place prices the cart from the live menu, allocates an order number, writes the order
	// and its items, and starts a payment -- all in one transaction (PRD 7, DECISIONS.md D12).
	//
	// idempotencyKey may be empty; when present, a retry returns the original order.
	Place(ctx context.Context, guest *GuestPrincipal, req *types.RequestPlaceOrder, idempotencyKey string) (*types.ResponsePlaceOrder, *response.ApplicationError)
	// GetForGuest returns one order, verifying the session owns it.
	GetForGuest(ctx context.Context, guest *GuestPrincipal, uid string) (*types.OrderView, *response.ApplicationError)
	// ListForGuest is "your orders at this table this sitting" (DECISIONS.md D5).
	ListForGuest(ctx context.Context, guest *GuestPrincipal) (*types.ResponseGuestOrders, *response.ApplicationError)
	// CancelByGuest withdraws an order the kitchen has not started (DECISIONS.md D6).
	CancelByGuest(ctx context.Context, guest *GuestPrincipal, uid string) (*types.OrderView, *response.ApplicationError)

	ListForStaff(ctx context.Context, actor *StaffPrincipal, req *types.RequestListOrders) (*types.ResponseOrderList, *response.ApplicationError)
	GetForStaff(ctx context.Context, actor *StaffPrincipal, uid string) (*types.OrderView, *response.ApplicationError)
	// Transition applies a status change, validated against the state machine under a row
	// lock so concurrent staff actions resolve to one winner.
	Transition(ctx context.Context, actor *StaffPrincipal, uid string, req *types.RequestTransitionOrder) (*types.OrderView, *response.ApplicationError)
	// CancelItem voids one line without voiding the order, recomputing the totals (PRD 9.1).
	CancelItem(ctx context.Context, actor *StaffPrincipal, orderUID, itemUID string, req *types.RequestCancelOrderItem) (*types.OrderView, *response.ApplicationError)
	// MarkPaidBySystem is called by the payment service when money settles. It is on this
	// interface rather than reaching into the order repository directly so that the status
	// log and the realtime publish happen for a webhook exactly as they do for a human.
	MarkPaidBySystem(ctx context.Context, orderID int32, actorID string) *response.ApplicationError
}

// ServicePaymentMethods handles payment intents, confirmation and webhooks (DECISIONS.md D2).
type ServicePaymentMethods interface {
	// CreateForOrder starts a payment against an already-placed order.
	CreateForOrder(ctx context.Context, guest *GuestPrincipal, orderUID string, req *types.RequestCreatePayment) (*types.PaymentView, *response.ApplicationError)
	// GetStatus is what the diner app polls while awaiting confirmation.
	GetStatus(ctx context.Context, guest *GuestPrincipal, orderUID string) (*types.ResponsePaymentStatus, *response.ApplicationError)
	// ConfirmByStaff settles a payment no gateway can confirm -- cash, or a static-UPI
	// transfer staff saw land. Attributable: the actor is recorded.
	ConfirmByStaff(ctx context.Context, actor *StaffPrincipal, orderUID string, req *types.RequestConfirmPayment) (*types.PaymentView, *response.ApplicationError)
	MarkFailedByStaff(ctx context.Context, actor *StaffPrincipal, orderUID string, req *types.RequestMarkPaymentFailed) (*types.PaymentView, *response.ApplicationError)
	// HandleWebhook verifies, deduplicates and applies a provider callback.
	HandleWebhook(ctx context.Context, provider string, raw []byte, headers map[string]string) *response.ApplicationError
	// StartIntentForOrder is called inside order placement to create the payment row.
	// Takes a tx because it participates in the placement transaction.
	StartIntentForOrder(ctx context.Context, order *models.Order, restaurant *models.Restaurant) (*types.PaymentView, *response.ApplicationError)
}

// ServicePlatformMethods is the operator surface: it creates tenants (DECISIONS.md D14).
//
// The only interface here whose methods take no principal. There is deliberately no
// PlatformPrincipal to pass: authorisation is a shared secret checked in middleware, not an
// identity, because a staff login belongs to exactly one restaurant and so cannot represent
// someone acting across all of them (DECISIONS.md D3). Nothing reachable from a staff or guest
// token calls anything on this interface.
type ServicePlatformMethods interface {
	// OnboardRestaurant creates a restaurant, its first owner login, and optionally its floor
	// of tables, in one transaction.
	OnboardRestaurant(ctx context.Context, req *types.RequestOnboardRestaurant) (*types.ResponseOnboardRestaurant, *response.ApplicationError)
	// ListRestaurants returns every tenant, including inactive ones -- which is exactly what
	// the public directory withholds (DECISIONS.md D13).
	ListRestaurants(ctx context.Context) (*types.ResponsePlatformRestaurantList, *response.ApplicationError)
}

// ServiceStatsMethods backs the admin dashboard (PRD 3).
type ServiceStatsMethods interface {
	Today(ctx context.Context, actor *StaffPrincipal) (*types.OrderStatsView, *response.ApplicationError)
	Range(ctx context.Context, actor *StaffPrincipal, from, to string) (*types.OrderStatsView, *response.ApplicationError)
}
