package types

// The operator surface: creating a restaurant, which is the root of a tenant
// (DECISIONS.md D14).
//
// These DTOs are not reachable from a staff or guest credential. A staff JWT carries exactly
// one restaurant_id, so there is no principal in the tenant model that could describe someone
// acting across all of them (DECISIONS.md D3) -- which is why onboarding lives behind its own
// route group and its own shared secret rather than behind an "admin" role.

// RequestOnboardRestaurant creates a restaurant, its first owner login, and optionally its
// floor of tables, in one call.
//
// One call rather than three, because the three are useless apart: a restaurant with no owner
// cannot be signed into and a restaurant with no tables cannot be scanned, so a partially
// onboarded tenant is a support ticket rather than a usable state. The service writes all of it
// in a single transaction for the same reason.
type RequestOnboardRestaurant struct {
	Name string `json:"name" binding:"required,min=1,max=128"`
	// Slug is the URL segment in the restaurant-level fallback QR, /r/{slug} (DECISIONS.md D4).
	// Omit it and the server derives one from Name; supply it when the derived form is ugly or
	// already taken. Either way it is normalised, so "Spice Garden!" and "spice-garden" arrive
	// at the same value.
	Slug        string `json:"slug,omitempty" binding:"omitempty,max=64"`
	Description string `json:"description,omitempty"`
	LogoURL     string `json:"logo_url,omitempty"`
	Address     string `json:"address,omitempty"`
	Phone       string `json:"phone,omitempty" binding:"omitempty,max=20"`
	// Timezone is an IANA name. It decides when the daily order-number counter rolls over
	// and what "today" means on the dashboard, so it is validated rather than defaulted
	// silently (DECISIONS.md D9).
	Timezone  string `json:"timezone,omitempty" binding:"omitempty,max=64"`
	Currency  string `json:"currency,omitempty" binding:"omitempty,max=8"`
	GSTNumber string `json:"gst_number,omitempty" binding:"omitempty,max=20"`
	// TaxBps and ServiceChargeBps are basis points: 500 = 5.00%. Pointers, so "not supplied"
	// takes the column default rather than pinning the rate to zero -- a restaurant onboarded
	// with an omitted tax field should inherit 5% GST, not become tax-free.
	TaxBps           *int   `json:"tax_bps,omitempty" binding:"omitempty,min=0,max=10000"`
	ServiceChargeBps *int   `json:"service_charge_bps,omitempty" binding:"omitempty,min=0,max=10000"`
	UPIVPA           string `json:"upi_vpa,omitempty" binding:"omitempty,max=128"`
	UPIPayeeName     string `json:"upi_payee_name,omitempty" binding:"omitempty,max=128"`
	PaymentProvider  string `json:"payment_provider,omitempty" binding:"omitempty,oneof=upi_static razorpay mock"`

	// Owner is required. A restaurant whose owner was left for later is one nobody can sign
	// into, and the only fix is direct database access.
	Owner RequestOnboardOwner `json:"owner" binding:"required"`
	// Tables is optional. Onboarding without a floor is legitimate -- a restaurant that has
	// not counted its tables yet can add them from the admin panel -- and the restaurant-level
	// fallback QR works with none (DECISIONS.md D4).
	Tables *RequestOnboardTables `json:"tables,omitempty"`
}

// RequestOnboardOwner is the first staff login, always created with the owner role.
//
// The role is not a field: the first account has to be able to create the others, and an
// onboarding call that produced a `staff`-role login would leave the restaurant unable to add
// anyone. The owner changes their own password from the panel afterwards.
type RequestOnboardOwner struct {
	Name     string `json:"name" binding:"required,min=1,max=128"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8,max=128"`
}

// RequestOnboardTables describes a numbered range of tables to create with the restaurant.
//
// Same shape as RequestBulkCreateTables, deliberately not the same type: that one is a
// tenant-scoped admin request and this one is part of an operator payload, and merging them
// would tie a change in either audience's contract to the other.
type RequestOnboardTables struct {
	// Prefix is prepended to each generated label, e.g. "T-" gives T-1 .. T-12.
	Prefix string `json:"prefix,omitempty" binding:"omitempty,max=16"`
	From   int    `json:"from" binding:"required,min=1,max=999"`
	To     int    `json:"to" binding:"required,min=1,max=999"`
	Seats  *int   `json:"seats,omitempty" binding:"omitempty,min=1,max=100"`
}

// ResponseOnboardRestaurant is everything the operator needs to hand the restaurant over.
//
// It carries the table QR URLs because those are the deliverable: onboarding that returns an
// id and leaves someone to go and find the codes has not finished the job. The owner's password
// is not echoed back -- whoever made the call already has it, and putting it in a response
// writes it into every proxy log on the way home.
type ResponseOnboardRestaurant struct {
	Restaurant RestaurantSettings `json:"restaurant"`
	Owner      StaffMember        `json:"owner"`
	// Tables is empty when none were requested, never null, so a client can iterate it
	// unconditionally.
	Tables []TableInfo `json:"tables"`
	// DinerURL is the restaurant-level landing page, the one QR that works before any table
	// sticker is printed.
	DinerURL string `json:"diner_url"`
	// AdminURL is where the owner signs in. Empty when app.admin_base_url is unset, since
	// guessing it would print the wrong link on a handover email.
	AdminURL string `json:"admin_url,omitempty"`
}

// ResponsePlatformRestaurantList is the operator's view of every tenant on the deployment.
//
// RestaurantSettings, not RestaurantSummary: an operator needs to see the status of an
// inactive restaurant and the tax configuration of a misconfigured one, which is exactly what
// the public directory withholds (DECISIONS.md D13). The two audiences get two types rather
// than one type with conditional fields, so neither can leak into the other by accident.
type ResponsePlatformRestaurantList struct {
	Restaurants []RestaurantSettings `json:"restaurants"`
}
