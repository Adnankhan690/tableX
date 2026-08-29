package repositories

// Compile-time proof that every implementation satisfies its frozen interface.
//
// In a _test.go file rather than production code so it costs nothing at build time, but
// still fails `go test` the moment an implementation drifts from interfaces.go. Without
// this, a signature mismatch would only surface at the NewRepositories call site, with a
// much less specific error.
var (
	_ RepositoryRestaurantMethods    = (*repositoryRestaurant)(nil)
	_ RepositoryStaffMethods         = (*repositoryStaff)(nil)
	_ RepositoryTableMethods         = (*repositoryTable)(nil)
	_ RepositoryMenuMethods          = (*repositoryMenu)(nil)
	_ RepositoryGuestSessionMethods  = (*repositoryGuestSession)(nil)
	_ RepositoryOrderMethods         = (*repositoryOrder)(nil)
	_ RepositoryPaymentMethods       = (*repositoryPayment)(nil)
	_ RepositoryPasswordResetMethods = (*repositoryPasswordReset)(nil)
	_ RepositoryDemoRequestMethods   = (*repositoryDemoRequest)(nil)
)
