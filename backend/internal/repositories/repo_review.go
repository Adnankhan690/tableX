package repositories

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"tablex/internal/models"
)

// repositoryReview is the data access for dish ratings.
type repositoryReview struct {
	*RepositoryAccess
}

// NewRepositoryReview returns the review repository bound to the shared access.
func NewRepositoryReview(access *RepositoryAccess) RepositoryReviewMethods {
	return &repositoryReview{RepositoryAccess: access}
}

// Query fragments, named for the same reason as the shared ones in access.go.
const (
	whereReviewOrderItem     = "order_item_id = ?"
	whereReviewOrder         = "order_id = ?"
	orderByReviewNewest      = "created_at DESC, id DESC"
	whereReviewHasComment    = "comment <> ''"
	whereReviewMenuItem      = "menu_item_id = ?"
	whereReviewRatingAtLeast = "rating >= ?"
	whereReviewRatingAtMost  = "rating <= ?"
	whereReviewCreatedFrom   = "created_at >= ?"
	whereReviewCreatedBefore = "created_at < ?"
)

// GetByOrderItemID resolves the one review a line may carry.
//
// Transaction-aware because the upsert path calls it inside its own transaction and must see
// that transaction's uncommitted writes. Reading through the pool there would report "no
// existing review" for a row the same transaction had just written, and the aggregate delta
// computed from that answer would count the dish twice.
func (a *repositoryReview) GetByOrderItemID(
	ctx context.Context, tx *gorm.DB, orderItemID int32,
) (*models.OrderItemReview, error) {
	review := &models.OrderItemReview{}
	// Take rather than First: order_item_id is uniquely indexed, so First's implicit ORDER BY
	// would be sort work on a single row.
	if err := a.conn(tx).WithContext(ctx).
		Where(whereReviewOrderItem, orderItemID).
		Take(review).Error; err != nil {
		return nil, fmt.Errorf("get review order_item=%d: %w", orderItemID, err)
	}
	return review, nil
}

// Create inserts a new review.
func (a *repositoryReview) Create(ctx context.Context, tx *gorm.DB, review *models.OrderItemReview) error {
	log := a.Logger.With(ctx)

	if err := a.conn(tx).WithContext(ctx).Create(review).Error; err != nil {
		return fmt.Errorf("create review uid=%s order_item=%d: %w", review.UID, review.OrderItemID, err)
	}

	log.Infof("[Create] review id=%d uid=%s order_item=%d menu_item=%d rating=%d",
		review.ID, review.UID, review.OrderItemID, review.MenuItemID, review.Rating)
	return nil
}

// UpdateFields patches an existing review in place.
func (a *repositoryReview) UpdateFields(
	ctx context.Context, tx *gorm.DB, id int32, fields map[string]any,
) error {
	if len(fields) == 0 {
		return nil
	}
	if err := a.conn(tx).WithContext(ctx).
		Model(&models.OrderItemReview{}).
		Where(whereID, id).
		Updates(fields).Error; err != nil {
		return fmt.Errorf("update review id=%d: %w", id, err)
	}
	return nil
}

// ListByOrder loads every review on one order.
func (a *repositoryReview) ListByOrder(ctx context.Context, orderID int32) ([]*models.OrderItemReview, error) {
	var reviews []*models.OrderItemReview
	if err := a.Db.WithContext(ctx).
		Where(whereReviewOrder, orderID).
		Find(&reviews).Error; err != nil {
		return nil, fmt.Errorf("list reviews order=%d: %w", orderID, err)
	}
	return reviews, nil
}

// reviewListScope is the feed's predicate, shared by the count and the page.
//
// One scope function rather than two copies of the same WHERE. A duplicated predicate is how
// a list starts disagreeing with its own "1-25 of 47" the first time a filter is added to only
// one of them.
func reviewListScope(filter ReviewListFilter) func(*gorm.DB) *gorm.DB {
	return func(q *gorm.DB) *gorm.DB {
		q = q.Where(whereRestaurant, filter.RestaurantID)

		if filter.MenuItemID > 0 {
			q = q.Where(whereReviewMenuItem, filter.MenuItemID)
		}
		if filter.MinRating > 0 {
			q = q.Where(whereReviewRatingAtLeast, filter.MinRating)
		}
		if filter.MaxRating > 0 {
			q = q.Where(whereReviewRatingAtMost, filter.MaxRating)
		}
		if filter.HasComment {
			q = q.Where(whereReviewHasComment)
		}
		if filter.From != nil {
			q = q.Where(whereReviewCreatedFrom, *filter.From)
		}
		// Exclusive upper bound. The service passes the day AFTER the requested one, so a
		// review left at 23:59:59.9 on the last day is inside the range -- which an inclusive
		// bound on a truncated date would drop.
		if filter.To != nil {
			q = q.Where(whereReviewCreatedBefore, *filter.To)
		}
		return q
	}
}

// List backs the admin feed.
//
// The order line and the order itself are preloaded rather than joined-and-selected, because
// the feed renders the dish name SNAPSHOTTED on the line (DECISIONS.md D8) and the order's
// human number. Two extra queries for a page of 25 rows, against one join whose result would
// then need hand-scanning into a projection struct.
func (a *repositoryReview) List(
	ctx context.Context, filter ReviewListFilter,
) ([]*models.OrderItemReview, int64, error) {
	scope := reviewListScope(filter)

	var total int64
	if err := a.Db.WithContext(ctx).
		Model(&models.OrderItemReview{}).
		Scopes(scope).
		Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count reviews restaurant=%d: %w", filter.RestaurantID, err)
	}
	if total == 0 {
		// Empty slice, not nil: this marshals as [] rather than null, which the admin table
		// can render without a special case.
		return []*models.OrderItemReview{}, 0, nil
	}

	q := a.Db.WithContext(ctx).
		Model(&models.OrderItemReview{}).
		Scopes(scope).
		Preload("OrderItem").
		Preload("Order").
		Preload("Order.Table").
		// Newest first, then id as a tiebreak: two reviews from one table can share a
		// created_at to the microsecond, and an unstable sort makes a row appear on page one
		// and again on page two.
		Order(orderByReviewNewest)

	// A zero limit means "no page". Pagination defaults belong to the service; inventing a
	// second default here is how two layers end up disagreeing about page size.
	if filter.Limit > 0 {
		q = q.Limit(filter.Limit)
	}
	if filter.Offset > 0 {
		q = q.Offset(filter.Offset)
	}

	rows := make([]*models.OrderItemReview, 0, filter.Limit)
	if err := q.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list reviews restaurant=%d: %w", filter.RestaurantID, err)
	}
	return rows, total, nil
}

// reviewDistributionRow receives the grouped count.
type reviewDistributionRow struct {
	Rating int
	Total  int64
}

// Distribution returns the count at each star, plus the overall count and sum.
//
// One GROUP BY rather than five counts: the five figures are rendered as one bar chart, so
// they must describe the same instant. Five round trips would let a review landing between
// them appear in one bar and not the total, and a chart whose bars do not add up to its own
// caption is a support ticket.
//
// The overall count and sum are derived from the same rows rather than queried separately,
// for the same reason.
func (a *repositoryReview) Distribution(
	ctx context.Context, restaurantID int32,
) (ReviewDistribution, int64, int64, error) {
	var dist ReviewDistribution

	var rows []reviewDistributionRow
	if err := a.Db.WithContext(ctx).
		Model(&models.OrderItemReview{}).
		Select("rating, COUNT(*) AS total").
		Where(whereRestaurant, restaurantID).
		Group("rating").
		Scan(&rows).Error; err != nil {
		return dist, 0, 0, fmt.Errorf("review distribution restaurant=%d: %w", restaurantID, err)
	}

	var count, sum int64
	for _, row := range rows {
		// Guarded rather than trusted. The CHECK constraint keeps ratings in range, but this
		// indexes an array from a database value, and a panic in a dashboard query is a worse
		// outcome than a bar that is quietly missing.
		if row.Rating < models.RatingMin || row.Rating > models.RatingMax {
			continue
		}
		dist[row.Rating-models.RatingMin] = row.Total
		count += row.Total
		sum += row.Total * int64(row.Rating)
	}

	return dist, count, sum, nil
}

// --- Service ratings (DECISIONS.md D17) ---

// Query fragments for the service feed, named for the same reason as the dish ones.
const (
	whereServiceSession = "guest_session_id = ?"
)

// GetServiceBySession resolves the one service review a session may carry.
//
// Transaction-aware for the same reason as GetByOrderItemID: the upsert calls it inside its own
// transaction and must see that transaction's uncommitted write, or the "does one exist" answer is
// wrong and a second row is attempted against a unique index.
func (a *repositoryReview) GetServiceBySession(
	ctx context.Context, tx *gorm.DB, sessionID int32,
) (*models.ServiceReview, error) {
	review := &models.ServiceReview{}
	// Take rather than First: guest_session_id is uniquely indexed.
	if err := a.conn(tx).WithContext(ctx).
		Where(whereServiceSession, sessionID).
		Take(review).Error; err != nil {
		return nil, fmt.Errorf("get service review session=%d: %w", sessionID, err)
	}
	return review, nil
}

// CreateService inserts a new service review.
func (a *repositoryReview) CreateService(ctx context.Context, tx *gorm.DB, review *models.ServiceReview) error {
	log := a.Logger.With(ctx)

	if err := a.conn(tx).WithContext(ctx).Create(review).Error; err != nil {
		return fmt.Errorf("create service review uid=%s: %w", review.UID, err)
	}

	log.Infof("[CreateService] service review id=%d uid=%s order=%d rating=%d",
		review.ID, review.UID, review.OrderID, review.Rating)
	return nil
}

// UpdateServiceFields patches an existing service review in place.
func (a *repositoryReview) UpdateServiceFields(
	ctx context.Context, tx *gorm.DB, id int32, fields map[string]any,
) error {
	if len(fields) == 0 {
		return nil
	}
	if err := a.conn(tx).WithContext(ctx).
		Model(&models.ServiceReview{}).
		Where(whereID, id).
		Updates(fields).Error; err != nil {
		return fmt.Errorf("update service review id=%d: %w", id, err)
	}
	return nil
}

// serviceListScope is the service feed's predicate, shared by the count and the page.
func serviceListScope(filter ServiceReviewListFilter) func(*gorm.DB) *gorm.DB {
	return func(q *gorm.DB) *gorm.DB {
		q = q.Where(whereRestaurant, filter.RestaurantID)

		if filter.MinRating > 0 {
			q = q.Where(whereReviewRatingAtLeast, filter.MinRating)
		}
		if filter.MaxRating > 0 {
			q = q.Where(whereReviewRatingAtMost, filter.MaxRating)
		}
		if filter.HasComment {
			q = q.Where(whereReviewHasComment)
		}
		if filter.From != nil {
			q = q.Where(whereReviewCreatedFrom, *filter.From)
		}
		// Exclusive upper bound, as in reviewListScope: the service passes the day AFTER the
		// requested one so a rating left at 23:59:59.9 is inside the range.
		if filter.To != nil {
			q = q.Where(whereReviewCreatedBefore, *filter.To)
		}
		return q
	}
}

// ListService backs the admin service feed.
func (a *repositoryReview) ListService(
	ctx context.Context, filter ServiceReviewListFilter,
) ([]*models.ServiceReview, int64, error) {
	scope := serviceListScope(filter)

	var total int64
	if err := a.Db.WithContext(ctx).
		Model(&models.ServiceReview{}).
		Scopes(scope).
		Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count service reviews restaurant=%d: %w", filter.RestaurantID, err)
	}
	if total == 0 {
		// Empty slice, not nil: marshals as [] rather than null.
		return []*models.ServiceReview{}, 0, nil
	}

	q := a.Db.WithContext(ctx).
		Model(&models.ServiceReview{}).
		Scopes(scope).
		// The order and its table, so the feed can name the sitting staff need to find. One extra
		// query per page rather than a join whose result would need hand-scanning.
		Preload("Order").
		Preload("Order.Table").
		Order(orderByReviewNewest)

	if filter.Limit > 0 {
		q = q.Limit(filter.Limit)
	}
	if filter.Offset > 0 {
		q = q.Offset(filter.Offset)
	}

	rows := make([]*models.ServiceReview, 0, filter.Limit)
	if err := q.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list service reviews restaurant=%d: %w", filter.RestaurantID, err)
	}
	return rows, total, nil
}

// ServiceDistribution returns the count at each star, plus the overall count and sum.
//
// One GROUP BY, for the same reason as Distribution: the five figures render as one chart beside
// their own caption, so they must describe the same instant.
func (a *repositoryReview) ServiceDistribution(
	ctx context.Context, restaurantID int32,
) (ReviewDistribution, int64, int64, error) {
	var dist ReviewDistribution

	var rows []reviewDistributionRow
	if err := a.Db.WithContext(ctx).
		Model(&models.ServiceReview{}).
		Select("rating, COUNT(*) AS total").
		Where(whereRestaurant, restaurantID).
		Group("rating").
		Scan(&rows).Error; err != nil {
		return dist, 0, 0, fmt.Errorf("service distribution restaurant=%d: %w", restaurantID, err)
	}

	var count, sum int64
	for _, row := range rows {
		// Guarded rather than trusted, as in Distribution: this indexes an array from a database
		// value, and a panic in a dashboard query is worse than a bar that is quietly missing.
		if row.Rating < models.RatingMin || row.Rating > models.RatingMax {
			continue
		}
		dist[row.Rating-models.RatingMin] = row.Total
		count += row.Total
		sum += row.Total * int64(row.Rating)
	}

	return dist, count, sum, nil
}
