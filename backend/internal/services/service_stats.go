package services

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"tablex/internal/response"
	"tablex/internal/types"
)

// maxStatsRangeDays bounds a range query.
//
// An unbounded range is a cheap way to make the database scan the entire orders table on a
// single unauthenticated-looking request, and no dashboard needs more than a year at once.
const maxStatsRangeDays = 366

type serviceStats struct {
	Access *ServiceAccess
}

// NewServiceStats builds the dashboard service.
func NewServiceStats(access *ServiceAccess) ServiceStatsMethods {
	return &serviceStats{Access: access}
}

// Today reports the current service date's figures.
func (s *serviceStats) Today(
	ctx context.Context,
	actor *StaffPrincipal,
) (*types.OrderStatsView, *response.ApplicationError) {
	restaurant, err := s.Access.Repositories.Restaurant.GetByID(ctx, actor.RestaurantID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrRestaurantNotFound
		}
		s.Access.Logger.With(ctx).Errorf("[Today] restaurant lookup failed: %+v", err)
		return nil, response.ErrRestaurantFetchFailed
	}

	// The window is computed in the RESTAURANT's timezone, not UTC. A 1am order belongs to the
	// previous evening's service as far as the kitchen is concerned, and a UTC window would
	// split an Indian restaurant's dinner service across two "days" (DECISIONS.md D9).
	from := restaurant.BusinessDate(time.Now())
	to := from.Add(24 * time.Hour)

	return s.compute(ctx, actor.RestaurantID, from, to)
}

// Range reports figures between two dates, inclusive of both.
func (s *serviceStats) Range(
	ctx context.Context,
	actor *StaffPrincipal,
	fromRaw, toRaw string,
) (*types.OrderStatsView, *response.ApplicationError) {
	restaurant, err := s.Access.Repositories.Restaurant.GetByID(ctx, actor.RestaurantID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrRestaurantNotFound
		}
		s.Access.Logger.With(ctx).Errorf("[Range] restaurant lookup failed: %+v", err)
		return nil, response.ErrRestaurantFetchFailed
	}

	loc := restaurant.Location()

	from, err := time.ParseInLocation("2006-01-02", fromRaw, loc)
	if err != nil {
		return nil, response.ErrInvalidParams.WithMessage("from must be formatted YYYY-MM-DD")
	}
	to, err := time.ParseInLocation("2006-01-02", toRaw, loc)
	if err != nil {
		return nil, response.ErrInvalidParams.WithMessage("to must be formatted YYYY-MM-DD")
	}

	if to.Before(from) {
		return nil, response.ErrInvalidParams.WithMessage("to must not be before from")
	}
	// Inclusive of the end date: "to 2026-08-23" means the whole of that day.
	end := to.Add(24 * time.Hour)

	if end.Sub(from) > maxStatsRangeDays*24*time.Hour {
		return nil, response.ErrInvalidParams.WithMessage("range must be 366 days or fewer")
	}

	return s.compute(ctx, actor.RestaurantID, from, end)
}

func (s *serviceStats) compute(
	ctx context.Context,
	restaurantID int32,
	from, to time.Time,
) (*types.OrderStatsView, *response.ApplicationError) {
	stats, err := s.Access.Repositories.Order.Stats(ctx, restaurantID, from, to)
	if err != nil {
		s.Access.Logger.With(ctx).Errorf("[compute] stats query failed: %+v", err)
		return nil, response.ErrOrderFetchFailed
	}

	return &types.OrderStatsView{
		BusinessDate:    from.Format("2006-01-02"),
		OrdersPlaced:    stats.OrdersPlaced,
		OrdersCompleted: stats.OrdersCompleted,
		OrdersCancelled: stats.OrdersCancelled,
		OrdersLive:      stats.OrdersLive,
		Revenue:         money(stats.RevenueMinor, "INR"),
		UnpaidAmount:    money(stats.UnpaidMinor, "INR"),
		// Passed through as nil when there is no data. Nil renders as "--" on the dashboard;
		// coercing it to 0 would claim orders were accepted instantly, which is a different
		// and false statement.
		AvgAcceptSecs: stats.AvgAcceptSecs,
		AvgFulfilSecs: stats.AvgFulfilSecs,
	}, nil
}
