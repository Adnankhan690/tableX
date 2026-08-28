package services

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"tablex/internal/models"
	"tablex/internal/payments"
	"tablex/internal/response"
	"tablex/internal/types"
)

type serviceRestaurant struct {
	Access *ServiceAccess
}

// NewServiceRestaurant builds the restaurant settings service.
func NewServiceRestaurant(access *ServiceAccess) ServiceRestaurantMethods {
	return &serviceRestaurant{Access: access}
}

func (s *serviceRestaurant) GetSettings(
	ctx context.Context,
	actor *StaffPrincipal,
) (*types.RestaurantSettings, *response.ApplicationError) {
	restaurant, err := s.Access.Repositories.Restaurant.GetByID(ctx, actor.RestaurantID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrRestaurantNotFound
		}
		s.Access.Logger.With(ctx).Errorf("[GetSettings] %+v", err)
		return nil, response.ErrRestaurantFetchFailed
	}
	return toRestaurantSettings(restaurant), nil
}

func (s *serviceRestaurant) UpdateSettings(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestUpdateRestaurant,
) (*types.RestaurantSettings, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	// Floor staff move orders through the kitchen; they do not change the tax rate or the
	// payout account.
	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}

	restaurant, err := s.Access.Repositories.Restaurant.GetByID(ctx, actor.RestaurantID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrRestaurantNotFound
		}
		log.Errorf("[UpdateSettings] lookup failed: %+v", err)
		return nil, response.ErrRestaurantFetchFailed
	}

	fields := map[string]any{}
	applyString(fields, "name", req.Name)
	applyString(fields, "description", req.Description)
	applyString(fields, "logo_url", req.LogoURL)
	applyString(fields, "address", req.Address)
	applyString(fields, "phone", req.Phone)
	applyString(fields, "gst_number", req.GSTNumber)
	applyString(fields, "upi_vpa", req.UPIVPA)
	applyString(fields, "upi_payee_name", req.UPIPayeeName)

	if req.Timezone != nil {
		tz := strings.TrimSpace(*req.Timezone)
		// Validated here rather than on read. An unknown timezone would silently fall back to
		// IST at read time, which means the daily order counter would roll over at the wrong
		// hour and nobody would know why (DECISIONS.md D9).
		if tz != "" {
			probe := &models.Restaurant{Timezone: tz}
			if probe.Location().String() != tz {
				return nil, response.ErrValidation.WithMessage(
					"unknown timezone -- use an IANA name such as Asia/Kolkata")
			}
		}
		fields["timezone"] = tz
	}

	// Bounds are enforced by the request binding too, but repeated here because the service is
	// the layer that owns the invariant: a typo'd 5000 would charge every diner 50% tax.
	if req.TaxBps != nil {
		if *req.TaxBps < 0 || *req.TaxBps > 10000 {
			return nil, response.ErrValidation.WithMessage("tax must be between 0 and 100%")
		}
		fields["tax_bps"] = *req.TaxBps
	}
	if req.ServiceChargeBps != nil {
		if *req.ServiceChargeBps < 0 || *req.ServiceChargeBps > 10000 {
			return nil, response.ErrValidation.WithMessage("service charge must be between 0 and 100%")
		}
		fields["service_charge_bps"] = *req.ServiceChargeBps
	}

	if req.PaymentProvider != nil {
		provider := models.PaymentProviderName(strings.TrimSpace(*req.PaymentProvider))
		// Refuse a provider this deployment cannot serve. Accepting it would leave the
		// restaurant's payment screen quietly falling back on every order, with the owner
		// believing their gateway is live.
		if !s.Access.Payments.Has(string(provider)) {
			return nil, response.ErrPaymentUnsupported.WithMessage(
				"that payment provider is not available on this deployment")
		}
		fields["payment_provider"] = provider
	}

	if len(fields) == 0 {
		return toRestaurantSettings(restaurant), nil
	}

	updated, err := s.Access.Repositories.Restaurant.UpdateFields(ctx, restaurant.ID, fields)
	if err != nil {
		log.Errorf("[UpdateSettings] update failed: %+v", err)
		return nil, response.ErrRestaurantUpdateFailed
	}

	log.Infof("[UpdateSettings] restaurant %s updated by %s", updated.UID, actor.StaffUID)
	return toRestaurantSettings(updated), nil
}

// GetPublicBySlug backs the restaurant-level fallback QR landing page (DECISIONS.md D4).
//
// Returns only the public summary and the active tables. It must never leak the UPI VPA, the
// GST number, or a table's qr_token -- possession of a token is what authorises ordering, so
// exposing one here would defeat the whole per-table scheme.
func (s *serviceRestaurant) GetPublicBySlug(
	ctx context.Context,
	slug string,
) (*types.ResponseRestaurantLanding, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	restaurant, err := s.Access.Repositories.Restaurant.GetBySlug(ctx, strings.TrimSpace(slug))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrRestaurantNotFound
		}
		log.Errorf("[GetPublicBySlug] %q: %+v", slug, err)
		return nil, response.ErrRestaurantFetchFailed
	}
	if restaurant.Status != models.EntityStatusActive {
		return nil, response.ErrRestaurantInactive
	}

	tables, err := s.Access.Repositories.Table.ListByRestaurant(ctx, restaurant.ID, false)
	if err != nil {
		log.Errorf("[GetPublicBySlug] tables failed: %+v", err)
		return nil, response.ErrTableFetchFailed
	}

	views := make([]types.TableView, 0, len(tables))
	for _, table := range tables {
		// toTableView carries the label and the uid only, never the qr_token.
		views = append(views, toTableView(table))
	}

	return &types.ResponseRestaurantLanding{
		Restaurant: toRestaurantSummary(restaurant),
		Tables:     views,
	}, nil
}

// ListPublic lists the restaurants a diner could order from (DECISIONS.md D13).
//
// Inactive restaurants are filtered out here rather than in the query: the repository's List is
// also used by staff tooling that needs to see everything, and a public endpoint should not be the
// thing that decides what "everything" means.
func (s *serviceRestaurant) ListPublic(
	ctx context.Context,
) (*types.ResponseRestaurantDirectory, *response.ApplicationError) {
	rows, err := s.Access.Repositories.Restaurant.List(ctx)
	if err != nil {
		s.Access.Logger.With(ctx).Errorf("[ListPublic] %+v", err)
		return nil, response.ErrRestaurantFetchFailed
	}

	out := make([]types.RestaurantSummary, 0, len(rows))
	for _, restaurant := range rows {
		if restaurant.Status != models.EntityStatusActive {
			continue
		}
		// toRestaurantSummary, not toRestaurantSettings: the summary type is what makes it
		// structurally impossible to leak the UPI VPA or the tax configuration here.
		out = append(out, toRestaurantSummary(restaurant))
	}

	return &types.ResponseRestaurantDirectory{Restaurants: out}, nil
}

// GetPublicQR renders the QR code for a restaurant's table-picker landing page.
//
// Unauthenticated, unlike the per-table QR endpoint, and the difference is the payload rather than
// the audience: a table QR embeds an opaque token whose possession authorises ordering at that
// table, while this embeds only the slug that is already visible in the URL of the page it opens.
// There is nothing here to keep secret (DECISIONS.md D4).
func (s *serviceRestaurant) GetPublicQR(
	ctx context.Context,
	slug string,
	size int,
) (*types.RestaurantQRView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	restaurant, err := s.Access.Repositories.Restaurant.GetBySlug(ctx, strings.TrimSpace(slug))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrRestaurantNotFound
		}
		log.Errorf("[GetPublicQR] %q: %+v", slug, err)
		return nil, response.ErrRestaurantFetchFailed
	}
	if restaurant.Status != models.EntityStatusActive {
		return nil, response.ErrRestaurantInactive
	}

	url := restaurantLandingURL(s.Access.Cfg.App.DinerBaseURL, restaurant.Slug)

	png, err := payments.RenderQRPNG(url, size)
	if err != nil {
		// The image is the entire point of the request, so unlike a payment QR there is no
		// degraded mode to fall back to.
		log.Errorf("[GetPublicQR] render %q: %+v", url, err)
		return nil, response.ErrQRRenderFailed
	}

	return &types.RestaurantQRView{
		Name:      restaurant.Name,
		Slug:      restaurant.Slug,
		QRURL:     url,
		PNGBase64: png,
	}, nil
}

// SetAcceptingOrders flips the "we are open" switch (DECISIONS.md D18).
//
// No role check, deliberately, and it is the only settings write without one. Closing up is a
// floor action taken by whoever is actually standing there at the end of service; requiring a
// manager would mean orders keep arriving after the kitchen has gone home, which is the exact
// failure the switch exists to prevent. The same reasoning already puts menu availability in every
// role's hands.
func (s *serviceRestaurant) SetAcceptingOrders(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestSetAcceptingOrders,
) (*types.RestaurantSettings, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	restaurant, err := s.Access.Repositories.Restaurant.UpdateFields(
		ctx, actor.RestaurantID, map[string]any{"accepting_orders": req.AcceptingOrders})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrRestaurantNotFound
		}
		log.Errorf("[SetAcceptingOrders] restaurant=%d: %+v", actor.RestaurantID, err)
		return nil, response.ErrRestaurantUpdateFailed
	}

	// Said out loud in the log, because it is the one setting whose effect is invisible on the
	// admin panel until a diner complains that they cannot order.
	log.Infof("[SetAcceptingOrders] restaurant=%d accepting=%t by staff=%s",
		actor.RestaurantID, req.AcceptingOrders, actor.StaffUID)

	return toRestaurantSettings(restaurant), nil
}
