package services

import (
	"context"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"tablex/internal/models"
	"tablex/internal/response"
	"tablex/internal/types"
	"tablex/internal/utils"
)

// defaultCurrency is what a restaurant gets when the onboarding call omits one. It matches
// the column default in migration 001, so an omitted field and a fresh row agree.
const defaultCurrency = "INR"

// defaultTimezone is the market default. Named here rather than left to the column default
// because the onboarding response echoes the value back, and echoing an empty string would
// tell the operator the restaurant has no timezone when it has IST.
const defaultTimezone = "Asia/Kolkata"

type servicePlatform struct {
	Access *ServiceAccess
}

// NewServicePlatform builds the operator service that creates tenants (DECISIONS.md D14).
func NewServicePlatform(access *ServiceAccess) ServicePlatformMethods {
	return &servicePlatform{Access: access}
}

// OnboardRestaurant creates a restaurant, its first owner login and optionally its floor.
//
// Everything is validated before the transaction opens, and the transaction then does nothing
// but write. That split matters here more than anywhere else in the codebase: this is the only
// operation that creates a tenant root, and a half-created tenant -- a restaurant with no
// owner, or an owner whose email collides so nobody can sign in -- is not something a retry
// fixes. It needs direct database access to unpick.
func (s *servicePlatform) OnboardRestaurant(
	ctx context.Context,
	req *types.RequestOnboardRestaurant,
) (*types.ResponseOnboardRestaurant, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, response.ErrValidation.WithMessage("the restaurant needs a name")
	}

	slug, appErr := resolveRestaurantSlug(name, req.Slug)
	if appErr != nil {
		return nil, appErr
	}

	timezone, appErr := resolveTimezone(req.Timezone)
	if appErr != nil {
		return nil, appErr
	}

	provider, appErr := s.resolvePaymentProvider(req.PaymentProvider)
	if appErr != nil {
		return nil, appErr
	}

	labels, appErr := planOnboardingTables(req.Tables)
	if appErr != nil {
		return nil, appErr
	}

	// Advisory, not the guarantee -- the unique index on restaurant.slug is. It runs first so
	// the common case, an operator retyping a name that already exists, is a readable 409
	// instead of a constraint violation surfacing as a 500.
	taken, err := s.Access.Repositories.Restaurant.SlugExists(ctx, slug, 0)
	if err != nil {
		log.Errorf("[OnboardRestaurant] slug check failed: %+v", err)
		return nil, response.ErrRestaurantCreateFailed
	}
	if taken {
		return nil, response.ErrRestaurantSlugTaken.WithMessage(
			fmt.Sprintf("the URL /r/%s is already taken -- choose a different slug", slug))
	}

	email := normalizeEmail(req.Owner.Email)

	// Email is unique per restaurant, not globally, so the database would accept this address
	// at a second restaurant quite happily. Login would not: it refuses an address that matches
	// more than one staff row rather than guessing which restaurant was meant. Creating the
	// account anyway would produce a login that can never succeed, which is worse than refusing
	// here -- so this check is a correctness requirement, not a convenience.
	existing, err := s.Access.Repositories.Staff.GetByEmailAnyRestaurant(ctx, email)
	if err != nil {
		log.Errorf("[OnboardRestaurant] owner email check failed: %+v", err)
		return nil, response.ErrRestaurantCreateFailed
	}
	if len(existing) > 0 {
		return nil, response.ErrEmailTaken.WithMessage(
			"that email already signs in to another restaurant on this platform -- " +
				"an address used twice makes login ambiguous, so use a different one")
	}

	// Hashed before the transaction opens. At cost 12 bcrypt takes a few hundred milliseconds,
	// and holding a write transaction open across it for no reason lengthens the window in
	// which a concurrent onboarding can contend on the slug index.
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Owner.Password), s.Access.Cfg.Auth.BcryptCost)
	if err != nil {
		log.Errorf("[OnboardRestaurant] hashing failed: %+v", err)
		return nil, response.ErrRestaurantCreateFailed
	}

	restaurant := &models.Restaurant{
		UID:              utils.GenerateUID(utils.UIDPrefixRestaurant),
		Name:             name,
		Slug:             slug,
		Description:      strings.TrimSpace(req.Description),
		LogoURL:          strings.TrimSpace(req.LogoURL),
		Address:          strings.TrimSpace(req.Address),
		Phone:            strings.TrimSpace(req.Phone),
		Currency:         resolveCurrency(req.Currency),
		Timezone:         timezone,
		GSTNumber:        strings.TrimSpace(req.GSTNumber),
		TaxBps:           valueOr(req.TaxBps, defaultTaxBps),
		ServiceChargeBps: valueOr(req.ServiceChargeBps, 0),
		UPIVPA:           strings.TrimSpace(req.UPIVPA),
		UPIPayeeName:     strings.TrimSpace(req.UPIPayeeName),
		PaymentProvider:  provider,
		Status:           models.EntityStatusActive,
	}

	owner := &models.StaffUser{
		UID:          utils.GenerateUID(utils.UIDPrefixStaff),
		Email:        email,
		PasswordHash: string(hash),
		Name:         strings.TrimSpace(req.Owner.Name),
		// Always owner. The first account has to be able to create the others, and an
		// onboarding that produced a manager-role login would leave the restaurant unable to
		// add staff without an operator intervening again.
		Role:   models.StaffRoleOwner,
		Status: models.EntityStatusActive,
	}

	tables := make([]*models.RestaurantTable, 0, len(labels))
	for _, label := range labels {
		tables = append(tables, &models.RestaurantTable{
			UID:     utils.GenerateUID(utils.UIDPrefixTable),
			Label:   label,
			QRToken: utils.GenerateQRToken(),
			Seats:   tableSeats(req.Tables),
			Status:  models.EntityStatusActive,
		})
	}

	// One transaction for all of it. The restaurant's id is not known until it is inserted, so
	// the owner and the tables are stamped inside -- which is also why this cannot be three
	// calls from the controller.
	err = s.Access.Db.Transaction(ctx, func(tx *gorm.DB) error {
		if err := s.Access.Repositories.Restaurant.Create(ctx, tx, restaurant); err != nil {
			return err
		}

		owner.RestaurantID = restaurant.ID
		if err := s.Access.Repositories.Staff.Create(ctx, tx, owner); err != nil {
			return err
		}

		if len(tables) == 0 {
			return nil
		}
		for _, table := range tables {
			table.RestaurantID = restaurant.ID
		}
		return s.Access.Repositories.Table.CreateBatch(ctx, tx, tables)
	})
	if err != nil {
		// A failure after the advisory check passed is most often the slug racing another
		// onboarding: the unique index is the real guarantee, and it fires here. Re-checking is
		// how the operator gets the same readable 409 as the first-line check rather than a 500
		// that says nothing about what to change.
		if raced, checkErr := s.Access.Repositories.Restaurant.SlugExists(ctx, slug, 0); checkErr == nil && raced {
			return nil, response.ErrRestaurantSlugTaken.WithMessage(
				fmt.Sprintf("the URL /r/%s was taken while this request was in flight", slug))
		}
		log.Errorf("[OnboardRestaurant] transaction failed for slug %q: %+v", slug, err)
		return nil, response.ErrRestaurantCreateFailed
	}

	// Info, and worth the line: this is the only event that creates a tenant, and it is the
	// first thing anyone looks for when asked where a restaurant came from.
	log.Infof("[OnboardRestaurant] onboarded restaurant %s (slug=%q) with owner %s and %d table(s)",
		restaurant.UID, restaurant.Slug, owner.UID, len(tables))

	base := s.Access.Cfg.App.DinerBaseURL
	views := make([]types.TableInfo, 0, len(tables))
	for _, table := range tables {
		views = append(views, toTableInfo(table, tableQRURL(base, table.QRToken), 0))
	}

	return &types.ResponseOnboardRestaurant{
		Restaurant: *toRestaurantSettings(restaurant),
		Owner:      toStaffMember(owner),
		Tables:     views,
		DinerURL:   restaurantLandingURL(base, restaurant.Slug),
		// Trimmed of a trailing slash but otherwise passed through. Left empty when unset
		// rather than guessed, because a wrong sign-in link on a handover email costs a
		// support call.
		AdminURL: strings.TrimRight(strings.TrimSpace(s.Access.Cfg.App.AdminBaseURL), "/"),
	}, nil
}

// ListRestaurants is the operator's inventory of tenants.
//
// Unfiltered, unlike the public directory: an operator's first question about a restaurant that
// is not taking orders is whether it exists and what its status is, and a list that hides
// inactive rows cannot answer either (DECISIONS.md D13).
func (s *servicePlatform) ListRestaurants(
	ctx context.Context,
) (*types.ResponsePlatformRestaurantList, *response.ApplicationError) {
	rows, err := s.Access.Repositories.Restaurant.List(ctx)
	if err != nil {
		s.Access.Logger.With(ctx).Errorf("[ListRestaurants] %+v", err)
		return nil, response.ErrRestaurantFetchFailed
	}

	out := make([]types.RestaurantSettings, 0, len(rows))
	for _, restaurant := range rows {
		out = append(out, *toRestaurantSettings(restaurant))
	}
	return &types.ResponsePlatformRestaurantList{Restaurants: out}, nil
}

// resolvePaymentProvider validates the requested provider against what this deployment can
// actually serve, defaulting to the configured fallback.
//
// Refusing an unavailable provider rather than accepting it is the same call UpdateSettings
// makes: a restaurant onboarded onto a gateway with no credentials would fall back silently on
// every order while its owner believed the gateway was live.
func (s *servicePlatform) resolvePaymentProvider(
	raw string,
) (models.PaymentProviderName, *response.ApplicationError) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return models.PaymentProviderName(s.Access.Cfg.Payments.DefaultProvider), nil
	}
	if !s.Access.Payments.Has(name) {
		return "", response.ErrPaymentUnsupported.WithMessage(
			"that payment provider is not available on this deployment")
	}
	return models.PaymentProviderName(name), nil
}

// defaultTaxBps mirrors the column default in migration 001: 5% GST.
const defaultTaxBps = 500

// resolveRestaurantSlug decides the /r/{slug} segment, normalising whichever source it comes
// from (DECISIONS.md D4).
//
// A supplied slug is normalised rather than rejected for containing a space or a capital: the
// operator's intent is obvious, and refusing "Spice Garden" when the answer is "spice-garden"
// is a worse experience than fixing it. What cannot be fixed is a value that normalises to
// nothing, which is why that is the one hard failure.
func resolveRestaurantSlug(name, supplied string) (string, *response.ApplicationError) {
	source := strings.TrimSpace(supplied)
	derived := false
	if source == "" {
		source = name
		derived = true
	}

	slug := utils.Slugify(source)
	if slug == "" {
		if derived {
			return "", response.ErrValidation.WithMessage(
				"the name has no letters or digits to build a URL from -- supply a slug explicitly")
		}
		return "", response.ErrValidation.WithMessage(
			"the slug must contain at least one letter or digit")
	}

	// The column is VARCHAR(64). Truncating silently would hand two restaurants with long,
	// similar names the same URL, so an over-long slug is refused rather than trimmed.
	if len(slug) > maxSlugLength {
		return "", response.ErrValidation.WithMessage(
			fmt.Sprintf("the slug is %d characters after normalising -- the limit is %d",
				len(slug), maxSlugLength))
	}
	return slug, nil
}

// maxSlugLength matches restaurant.slug VARCHAR(64) in migration 001.
const maxSlugLength = 64

// resolveTimezone validates an IANA timezone name, defaulting to the market default.
//
// Validated on write rather than on read for the reason UpdateSettings gives: an unknown zone
// falls back to IST when the row is read, which means the daily order-number counter rolls over
// at the wrong hour and nothing anywhere says why (DECISIONS.md D9).
func resolveTimezone(raw string) (string, *response.ApplicationError) {
	tz := strings.TrimSpace(raw)
	if tz == "" {
		return defaultTimezone, nil
	}
	probe := &models.Restaurant{Timezone: tz}
	if probe.Location().String() != tz {
		return "", response.ErrValidation.WithMessage(
			"unknown timezone -- use an IANA name such as Asia/Kolkata")
	}
	return tz, nil
}

// resolveCurrency normalises the currency code, defaulting to INR.
//
// Uppercased rather than validated against a currency list: every amount in this system is
// already formatted as rupees by utils.FormatINR, so a non-INR value is a display bug waiting
// to happen and not something a longer allowlist would prevent. The field exists so the column
// is not hard-coded, not because v1 supports multiple currencies.
func resolveCurrency(raw string) string {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if code == "" {
		return defaultCurrency
	}
	return code
}

// planOnboardingTables turns a numbered range into the labels to create.
//
// Returns an empty slice for a nil range, so the caller has no special case: onboarding without
// a floor is legitimate, and the restaurant-level fallback QR works with no tables at all
// (DECISIONS.md D4).
//
// No duplicate check against the database, unlike serviceTable.BulkCreate: the restaurant is
// being created in this same transaction, so it has no existing tables to collide with. The
// range is checked for self-consistency instead.
func planOnboardingTables(req *types.RequestOnboardTables) ([]string, *response.ApplicationError) {
	if req == nil {
		return nil, nil
	}
	if req.To < req.From {
		return nil, response.ErrValidation.WithMessage("'to' must not be less than 'from'")
	}
	count := req.To - req.From + 1
	if count > maxBulkTables {
		return nil, response.ErrValidation.WithMessage(
			fmt.Sprintf("at most %d tables can be created at once", maxBulkTables))
	}

	prefix := strings.TrimSpace(req.Prefix)
	labels := make([]string, 0, count)
	for n := req.From; n <= req.To; n++ {
		labels = append(labels, fmt.Sprintf("%s%d", prefix, n))
	}
	return labels, nil
}

// tableSeats reads the optional seat count off a possibly-nil range.
func tableSeats(req *types.RequestOnboardTables) *int {
	if req == nil {
		return nil
	}
	return req.Seats
}

// valueOr dereferences an optional field, falling back to a default.
//
// Distinct from applyString and friends, which stage PATCH updates where nil means "leave the
// column alone". Here there is no existing row, so nil means "take the default" -- and
// collapsing the two would onboard a restaurant with 0% tax whenever the field was omitted.
func valueOr[T any](value *T, fallback T) T {
	if value == nil {
		return fallback
	}
	return *value
}
