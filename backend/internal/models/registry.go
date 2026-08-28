package models

// All returns every entity this binary expects to find in the database.
//
// Exists so readiness can verify the SCHEMA ITSELF rather than a bookkeeping table. That
// distinction is the whole design: `make migrate` applies the SQL with psql and never writes
// `schema_migration`, so a check against that ledger reports a perfectly healthy development
// database as entirely unmigrated. Tables and columns are the truth; the ledger is a record of
// how one particular tool got there.
//
// ADD NEW MODELS HERE. One missing from this list is simply not checked -- which fails open, the
// wrong direction, but no worse than not having the check at all.
func All() []any {
	return []any{
		&Restaurant{},
		&StaffUser{},
		&RestaurantTable{},
		&MenuCategory{},
		&MenuItem{},
		&GuestSession{},
		&Order{},
		&OrderItem{},
		&OrderStatusEvent{},
		&OrderCounter{},
		&OrderItemReview{},
		&ServiceReview{},
		&Payment{},
		&PaymentWebhookEvent{},
		&PasswordResetCode{},
	}
}
