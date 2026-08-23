package services

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"tablex/internal/models"
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
