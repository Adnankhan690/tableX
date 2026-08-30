package types

// RestaurantSummary is the public restaurant header the diner app renders above the menu.
//
// Deliberately narrow: it omits the UPI VPA, the GST number, and every other operational
// detail, because this object is served to anonymous callers.
type RestaurantSummary struct {
	UID         string `json:"uid"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description,omitempty"`
	LogoURL     string `json:"logo_url,omitempty"`
	Address     string `json:"address,omitempty"`
	Phone       string `json:"phone,omitempty"`
	Currency    string `json:"currency"`
	// AcceptingOrders is the "we are open" switch (DECISIONS.md D18). On the diner side it is what
	// turns the menu read-only; on the admin side it is what the board's toggle reflects.
	//
	// On the PUBLIC summary rather than the staff-only settings object, because a diner scanning at
	// 11pm needs to be told the kitchen is shut before they build a cart -- finding out at checkout
	// is the same information delivered at the worst possible moment.
	AcceptingOrders bool `json:"accepting_orders"`
}

// RestaurantSettings is the full, staff-only view.
type RestaurantSettings struct {
	RestaurantSummary
	Timezone string `json:"timezone"`
	// Email is the restaurant's contact address. On this staff-only object rather than
	// RestaurantSummary: the public directory is enumerable by anyone, and putting an address
	// there would publish a scrapeable list of them.
	Email            string `json:"email,omitempty"`
	GSTNumber        string `json:"gst_number,omitempty"`
	TaxBps           int    `json:"tax_bps"`
	ServiceChargeBps int    `json:"service_charge_bps"`
	UPIVPA           string `json:"upi_vpa,omitempty"`
	UPIPayeeName     string `json:"upi_payee_name,omitempty"`
	PaymentProvider  string `json:"payment_provider"`
	Status           string `json:"status"`
}

// RequestUpdateRestaurant patches restaurant settings.
type RequestUpdateRestaurant struct {
	Name        *string `json:"name,omitempty" binding:"omitempty,min=1,max=128"`
	Description *string `json:"description,omitempty"`
	LogoURL     *string `json:"logo_url,omitempty"`
	Address     *string `json:"address,omitempty"`
	Phone       *string `json:"phone,omitempty" binding:"omitempty,max=20"`
	// Length only. The SHAPE is checked in the service, deliberately: `binding:"omitempty,email"`
	// looks like it would do the job and does not. On a *string, validator's `omitempty` tests the
	// POINTER for nil, not the string for emptiness -- so a present-but-empty "email": "" reaches
	// the `email` rule and is rejected, which makes clearing the field impossible. It also fails as
	// a generic 400 "the request could not be understood", naming neither the field nor the
	// problem. The service returns a 422 that says which field and why.
	Email     *string `json:"email,omitempty" binding:"omitempty,max=254"`
	Timezone  *string `json:"timezone,omitempty"`
	GSTNumber *string `json:"gst_number,omitempty" binding:"omitempty,max=20"`
	// Basis points, 0-10000. Rejecting out-of-range here stops a typo'd "5000" from
	// charging every diner 50% tax.
	TaxBps           *int    `json:"tax_bps,omitempty" binding:"omitempty,min=0,max=10000"`
	ServiceChargeBps *int    `json:"service_charge_bps,omitempty" binding:"omitempty,min=0,max=10000"`
	UPIVPA           *string `json:"upi_vpa,omitempty" binding:"omitempty,max=128"`
	UPIPayeeName     *string `json:"upi_payee_name,omitempty" binding:"omitempty,max=128"`
	PaymentProvider  *string `json:"payment_provider,omitempty" binding:"omitempty,oneof=upi_static razorpay mock"`
}

// RestaurantQRView is a restaurant's own QR code, pointing at its table-picker landing page.
//
// Distinct from ResponseTableQR: a table QR embeds an opaque capability token and is therefore
// staff-only, whereas this embeds only the public slug that already appears in the URL of the page
// it opens. There is nothing here to keep secret, which is what makes it safe to serve
// unauthenticated (DECISIONS.md D4, D13).
type RestaurantQRView struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
	// QRURL is the encoded target: {diner_base_url}/r/{slug}.
	QRURL string `json:"qr_url"`
	// PNGBase64 is rendered server-side, so the diner app ships no QR library.
	PNGBase64 string `json:"png_base64,omitempty"`
}

// ResponseRestaurantDirectory lists the restaurants taking orders on this deployment.
//
// Carries only what /r/{slug} already exposes to anyone who scans a code. It adds enumerability,
// not a new class of information (DECISIONS.md D13).
type ResponseRestaurantDirectory struct {
	Restaurants []RestaurantSummary `json:"restaurants"`
}

// TableInfo is a table as the admin panel sees it.
type TableInfo struct {
	UID    string `json:"uid"`
	Label  string `json:"label"`
	Seats  *int   `json:"seats,omitempty"`
	Status string `json:"status"`
	// QRURL is the full URL encoded in this table's QR code. Staff-only: possession of it
	// authorises ordering at the table (DECISIONS.md D4).
	QRURL string `json:"qr_url,omitempty"`
	// LiveOrderCount powers the admin floor view.
	LiveOrderCount int64 `json:"live_order_count"`
}

// RequestCreateTable adds a table.
type RequestCreateTable struct {
	Label string `json:"label" binding:"required,min=1,max=32"`
	Seats *int   `json:"seats,omitempty" binding:"omitempty,min=1,max=100"`
}

// RequestUpdateTable patches a table.
type RequestUpdateTable struct {
	Label  *string `json:"label,omitempty" binding:"omitempty,min=1,max=32"`
	Seats  *int    `json:"seats,omitempty" binding:"omitempty,min=1,max=100"`
	Status *string `json:"status,omitempty" binding:"omitempty,oneof=active inactive archived"`
}

// RequestBulkCreateTables creates a numbered range in one call, because a restaurant
// onboarding thirty tables should not click thirty times.
type RequestBulkCreateTables struct {
	// Prefix is prepended to each generated label, e.g. "T-" gives T-1 .. T-30.
	Prefix string `json:"prefix" binding:"omitempty,max=16"`
	From   int    `json:"from" binding:"required,min=1,max=999"`
	To     int    `json:"to" binding:"required,min=1,max=999"`
	Seats  *int   `json:"seats,omitempty" binding:"omitempty,min=1,max=100"`
}

// ResponseTableList is the admin table list.
type ResponseTableList struct {
	Tables []TableInfo `json:"tables"`
}

// ResponseTableQR carries a table's QR payload for printing.
type ResponseTableQR struct {
	TableUID string `json:"table_uid"`
	Label    string `json:"label"`
	QRURL    string `json:"qr_url"`
	// PNGBase64 is a data-URI-ready rendering, so the print sheet needs no second request
	// per table.
	PNGBase64 string `json:"png_base64,omitempty"`
}

// RequestSetAcceptingOrders is the fast path staff use at open and close: one tap, one field.
//
// Separate from the full settings PATCH for the same reason RequestSetAvailability is separate
// from RequestUpdateMenuItem: closing up must not accidentally submit a stale tax rate from a
// settings form somebody left open in another tab.
type RequestSetAcceptingOrders struct {
	AcceptingOrders bool `json:"accepting_orders"`
}
