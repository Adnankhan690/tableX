package types

import "time"

// ResponseScanTable is what a diner's browser receives on scanning a table QR code.
//
// It answers everything the app needs in one round trip -- who the restaurant is, which
// table, the session token, and the whole menu -- because this response is the very first
// thing that happens after a scan and it sets the impression of how fast the product is
// (PRD 3, PRD 7).
type ResponseScanTable struct {
	Session GuestSessionView `json:"session"`
	Table   TableView        `json:"table"`
	Menu    ResponseMenu     `json:"menu"`
}

// GuestSessionView is the diner's anonymous identity (DECISIONS.md D5).
type GuestSessionView struct {
	UID string `json:"uid"`
	// Token is returned exactly once, here, and stored in the browser. Every later diner
	// request carries it as a bearer token.
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// TableView is the table a diner is sitting at. It carries the label, never the QR token.
type TableView struct {
	UID   string `json:"uid"`
	Label string `json:"label"`
}

// ResponseRestaurantLanding backs the restaurant-level fallback QR, /r/{slug}, where the
// diner picks their own table (DECISIONS.md D4).
type ResponseRestaurantLanding struct {
	Restaurant RestaurantSummary `json:"restaurant"`
	Tables     []TableView       `json:"tables"`
}

// RequestSelectTable claims a table from the fallback landing page.
type RequestSelectTable struct {
	TableUID string `json:"table_uid" binding:"required"`
}
