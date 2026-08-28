package services

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"tablex/internal/models"
	"tablex/internal/repositories"
	"tablex/internal/response"
	"tablex/internal/types"
	"tablex/internal/utils"
)

// uidPrefixReview namespaces a review's public identifier, as every entity here does.
const uidPrefixReview = "rev"

// MinRatingsToPublish is how many reviews a dish needs before its score is shown to DINERS.
//
// Below the threshold the menu shows no rating at all rather than a provisional one. A "5.0"
// backed by a single tap is not a smaller version of the truth, it is misinformation: it ranks
// a dish nobody has really tried above one with forty ratings averaging 4.6, and the next
// diner to leave a 3 visibly halves it. Staff see the raw count with no threshold, because
// they are owed the underlying data rather than the published summary.
const MinRatingsToPublish = 3

// MinReviewsForRanking is the floor for appearing in the best/worst tables on the admin
// dashboard. Lower than the diner threshold: a manager looking for problems wants to see a
// dish with two 1-star ratings, and is reading a screen that tells them the count.
const MinReviewsForRanking = 2

// rankedDishLimit is how many dishes each end of the ranking shows. A working list, not a
// report -- a manager acts on the worst few, and a table of forty is one nobody reads.
const rankedDishLimit = 5

// serviceReview owns rating and review business logic.
type serviceReview struct {
	Access *ServiceAccess
	// orders is held rather than reimplemented so that "does this session own this order"
	// has exactly one definition. A second copy of that check is how one of them ends up
	// missing a case and leaking another table's bill (DECISIONS.md D4).
	orders *ServiceOrder
}

// NewServiceReview builds the review service. It depends on the order service for ownership
// resolution, the same way the payment service does.
func NewServiceReview(access *ServiceAccess, orders *ServiceOrder) ServiceReviewMethods {
	return &serviceReview{Access: access, orders: orders}
}

// RateItem records a diner's rating of one dish. This is the whole diner-side write path.
//
// Idempotent by construction: it is a PUT of one line's rating, so the double-tap that plagues
// a stalled phone resolves to the same row with the same value rather than a second review. A
// diner correcting a mis-tapped star takes the same path and updates in place, which is what
// keeps the menu_item counters reconcilable against the review table.
func (s *serviceReview) RateItem(
	ctx context.Context,
	guest *GuestPrincipal,
	orderUID, itemUID string,
	req *types.RequestRateOrderItem,
) (*types.OrderItemReviewView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	// Ownership first, before any validation or write, so an unauthorised caller learns
	// nothing about an order that is not theirs -- not even whether their rating was well
	// formed.
	order, appErr := s.orders.loadGuestOrder(ctx, guest, orderUID)
	if appErr != nil {
		return nil, appErr
	}

	// The window. Server-side and authoritative: the client renders the card from can_review
	// on the order, but a client is not what enforces this (see review_window.go for why the
	// rule is not simply "status is served").
	if !ReviewEligibilityFor(order, time.Now().UTC()).Open {
		return nil, response.ErrReviewWindowClosed
	}

	item := findOrderItem(order, itemUID)
	if item == nil {
		return nil, response.ErrReviewItemNotFound
	}
	if !CanReviewItem(item) {
		return nil, response.ErrReviewItemCancelled
	}

	rating := req.Rating
	if !models.ValidRating(rating) {
		return nil, response.ErrReviewInvalidRating
	}

	tags, appErr := normalizeReviewTags(req.Tags)
	if appErr != nil {
		return nil, appErr
	}
	comment := strings.TrimSpace(req.Comment)

	var saved *models.OrderItemReview

	// One transaction covers the review row and the dish's aggregate counters. They are two
	// writes describing one fact, and a commit that lands only the first leaves an average
	// that is permanently wrong with nothing left to reconcile it against.
	err := s.Access.Db.Transaction(ctx, func(tx *gorm.DB) error {
		// Read through the transaction: this must see a row the same transaction may have
		// just written, or the delta below counts the dish twice.
		existing, err := s.Access.Repositories.Review.GetByOrderItemID(ctx, tx, item.ID)
		switch {
		case err == nil:
			// An update. The count does not move -- there is still one review -- and the sum
			// moves by the difference, so re-rating 4 to 5 adds exactly 1.
			delta := int64(rating - existing.Rating)

			fields := map[string]any{
				"rating":  rating,
				"tags":    models.ReviewTags(tags),
				"comment": comment,
			}
			if err := s.Access.Repositories.Review.UpdateFields(ctx, tx, existing.ID, fields); err != nil {
				return err
			}
			if err := s.Access.Repositories.Menu.AdjustRating(ctx, tx, existing.MenuItemID, 0, delta); err != nil {
				return err
			}

			existing.Rating = rating
			existing.Tags = models.ReviewTags(tags)
			existing.Comment = comment
			existing.UpdatedAt = time.Now().UTC()
			saved = existing
			return nil

		case errors.Is(err, gorm.ErrRecordNotFound):
			review := &models.OrderItemReview{
				UID:            utils.GenerateUID(uidPrefixReview),
				RestaurantID:   order.RestaurantID,
				OrderID:        order.ID,
				OrderItemID:    item.ID,
				MenuItemID:     item.MenuItemID,
				GuestSessionID: order.GuestSessionID,
				Rating:         rating,
				Tags:           models.ReviewTags(tags),
				Comment:        comment,
			}
			if err := s.Access.Repositories.Review.Create(ctx, tx, review); err != nil {
				return err
			}
			if err := s.Access.Repositories.Menu.AdjustRating(ctx, tx, item.MenuItemID, 1, int64(rating)); err != nil {
				return err
			}
			saved = review
			return nil

		default:
			return err
		}
	})
	if err != nil {
		log.Errorf("[RateItem] order=%s item=%s: %+v", orderUID, itemUID, err)
		return nil, response.ErrReviewSaveFailed
	}

	log.Infof("[RateItem] order=%s item=%s menu_item=%d rating=%d tags=%d",
		orderUID, itemUID, item.MenuItemID, rating, len(tags))

	// After the commit, never inside it. Publishing from within would announce a rating that a
	// rollback then discards, and the admin panel would show a complaint that does not exist.
	s.publishReviewEvent(guest.RestaurantUID, order.UID, guest.TableLabel, rating)

	view := toOrderItemReviewView(saved)
	return view, nil
}

// publishReviewEvent tells the admin panel a rating just landed.
//
// The event carries the rating itself rather than only an identifier -- the one place in this
// system where a payload is a value instead of a pointer to one (DECISIONS.md D10). It earns
// the exception because the panel highlights a low rating on arrival, and a refetch-first
// round trip would spend the seconds in which staff could still walk over to the table.
func (s *serviceReview) publishReviewEvent(restaurantUID, orderUID, tableLabel string, rating int) {
	if s.Access.Hub == nil {
		return
	}
	s.Access.Hub.PublishOrderEvent(restaurantUID, orderUID, types.Event{
		Type:       types.EventReviewSubmitted,
		OrderUID:   orderUID,
		TableLabel: tableLabel,
		Rating:     rating,
		At:         time.Now().UTC(),
	})
}

// ListForStaff backs the admin reviews feed.
func (s *serviceReview) ListForStaff(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestListReviews,
) (*types.ResponseReviewList, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	req.Pagination.Normalize()

	filter := repositories.ReviewListFilter{
		RestaurantID: actor.RestaurantID,
		MinRating:    req.MinRating,
		MaxRating:    req.MaxRating,
		HasComment:   req.HasComment,
		Offset:       req.Pagination.Offset(),
		Limit:        req.Pagination.Limit(),
	}

	// The dish filter arrives as a uid and is resolved here, scoped to this restaurant, so a
	// uid from another tenant reads as "no such dish" rather than filtering across the
	// boundary (DECISIONS.md D3).
	if uid := strings.TrimSpace(req.MenuItemUID); uid != "" {
		item, err := s.Access.Repositories.Menu.GetItemByUID(ctx, actor.RestaurantID, uid)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, response.ErrMenuItemNotFound
			}
			log.Errorf("[ListForStaff] resolve dish %s: %+v", uid, err)
			return nil, response.ErrReviewFetchFailed
		}
		filter.MenuItemID = item.ID
	}

	from, appErr := parseDateParam(req.From)
	if appErr != nil {
		return nil, appErr
	}
	to, appErr := parseDateParam(req.To)
	if appErr != nil {
		return nil, appErr
	}
	filter.From = from
	if to != nil {
		// Exclusive upper bound at the start of the following day, so "to=2026-03-14" includes
		// everything left on the 14th rather than stopping at midnight that morning.
		end := to.AddDate(0, 0, 1)
		filter.To = &end
	}

	reviews, total, err := s.Access.Repositories.Review.List(ctx, filter)
	if err != nil {
		log.Errorf("[ListForStaff] restaurant=%d: %+v", actor.RestaurantID, err)
		return nil, response.ErrReviewFetchFailed
	}

	// Resolving each review's dish uid from the menu, once, rather than preloading MenuItem on
	// every row: a page of 25 reviews of the same dish would otherwise load it 25 times.
	uidByMenuItemID, err := s.menuItemUIDs(ctx, actor.RestaurantID)
	if err != nil {
		log.Errorf("[ListForStaff] menu index restaurant=%d: %+v", actor.RestaurantID, err)
		return nil, response.ErrReviewFetchFailed
	}

	views := make([]types.ReviewView, 0, len(reviews))
	for _, review := range reviews {
		views = append(views, toReviewView(review, uidByMenuItemID[review.MenuItemID]))
	}

	return &types.ResponseReviewList{
		Reviews: views,
		Meta:    types.NewPageMeta(req.Pagination, total),
	}, nil
}

// SummaryForStaff is the reviews dashboard.
func (s *serviceReview) SummaryForStaff(
	ctx context.Context,
	actor *StaffPrincipal,
) (*types.ResponseReviewSummary, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	distribution, count, sum, err := s.Access.Repositories.Review.Distribution(ctx, actor.RestaurantID)
	if err != nil {
		log.Errorf("[SummaryForStaff] distribution restaurant=%d: %+v", actor.RestaurantID, err)
		return nil, response.ErrReviewFetchFailed
	}

	// The per-dish ranking comes from the counters already on menu_item, so this is one read
	// of a table with tens of rows rather than a GROUP BY over every review ever left. Ordering
	// happens in memory for the same reason migration 016 leaves those columns unindexed.
	items, err := s.Access.Repositories.Menu.ListItems(ctx, actor.RestaurantID, false)
	if err != nil {
		log.Errorf("[SummaryForStaff] items restaurant=%d: %+v", actor.RestaurantID, err)
		return nil, response.ErrReviewFetchFailed
	}

	ranked := rankDishesByRating(items)

	summary := &types.ResponseReviewSummary{
		Overall:              types.RatingSummary{Average: roundToOneDecimal(average(sum, count)), Count: count},
		Distribution:         distribution,
		NeedsAttention:       ranked.worst,
		TopRated:             ranked.best,
		MinReviewsForRanking: MinReviewsForRanking,
	}
	return summary, nil
}

// menuItemUIDs indexes this restaurant's dish ids to their uids.
func (s *serviceReview) menuItemUIDs(ctx context.Context, restaurantID int32) (map[int32]string, error) {
	// includeInactive, because a review outlives the dish being archived and the feed must
	// still be able to link it.
	items, err := s.Access.Repositories.Menu.ListItems(ctx, restaurantID, true)
	if err != nil {
		return nil, err
	}
	index := make(map[int32]string, len(items))
	for _, item := range items {
		index[item.ID] = item.UID
	}
	return index, nil
}

// findOrderItem resolves a line uid against an already-loaded order.
//
// In memory rather than a query: the order arrived with its lines preloaded, and a uid that is
// not among them must read as "not on this order" regardless of whether it exists elsewhere.
// A lookup by uid alone would resolve another table's line and then need a second check to
// undo that.
func findOrderItem(order *models.Order, itemUID string) *models.OrderItem {
	for i := range order.Items {
		if order.Items[i].UID == itemUID {
			return &order.Items[i]
		}
	}
	return nil
}

// normalizeReviewTags validates the tag list against the closed vocabulary and drops
// duplicates.
//
// Rejects rather than silently discarding an unrecognised tag. The entire value of a fixed
// vocabulary is that every stored tag can be counted; quietly dropping a typo lets a client
// ship one that looks like it works and produces a tag count nobody can account for.
func normalizeReviewTags(raw []string) ([]string, *response.ApplicationError) {
	if len(raw) == 0 {
		return nil, nil
	}
	if len(raw) > models.MaxReviewTags {
		return nil, response.ErrReviewTooManyTags
	}

	seen := make(map[string]bool, len(raw))
	out := make([]string, 0, len(raw))
	for _, candidate := range raw {
		tag := strings.TrimSpace(candidate)
		if tag == "" {
			continue
		}
		if !models.ReviewTag(tag).Valid() {
			return nil, response.ErrReviewInvalidTag
		}
		// A duplicate is a client bug rather than an attack, and deduplicating is kinder than
		// a 422 -- but it must not reach the column, or one diner's double-tap would count as
		// two people saying the same thing.
		if seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out, nil
}

// rankedDishes is the two ends of the menu by rating.
type rankedDishes struct {
	best  []types.RatedDishView
	worst []types.RatedDishView
}

// rankDishesByRating sorts the rated dishes and returns both ends.
//
// Dishes below MinReviewsForRanking are excluded entirely rather than ranked with their tiny
// sample. One 1-star rating would otherwise put a brand-new dish at the top of a list titled
// "needs attention", which sends a kitchen to fix something no evidence says is broken.
func rankDishesByRating(items []*models.MenuItem) rankedDishes {
	rated := make([]types.RatedDishView, 0, len(items))
	for _, item := range items {
		avg, ok := item.AverageRating()
		if !ok || item.RatingCount < MinReviewsForRanking {
			continue
		}
		rated = append(rated, types.RatedDishView{
			MenuItemUID: item.UID,
			Name:        item.Name,
			FoodType:    string(item.FoodType),
			Rating: types.RatingSummary{
				Average: roundToOneDecimal(avg),
				Count:   int64(item.RatingCount),
			},
		})
	}

	// Descending by score, then by count, then by name. The second and third keys are what
	// make the order stable: without them two dishes on 4.5 can swap places between requests,
	// and a list that reshuffles on refresh reads as a broken page.
	sort.SliceStable(rated, func(i, j int) bool {
		if rated[i].Rating.Average != rated[j].Rating.Average {
			return rated[i].Rating.Average > rated[j].Rating.Average
		}
		if rated[i].Rating.Count != rated[j].Rating.Count {
			return rated[i].Rating.Count > rated[j].Rating.Count
		}
		return rated[i].Name < rated[j].Name
	})

	best := make([]types.RatedDishView, 0, rankedDishLimit)
	for i := 0; i < len(rated) && i < rankedDishLimit; i++ {
		best = append(best, rated[i])
	}

	worst := make([]types.RatedDishView, 0, rankedDishLimit)
	for i := len(rated) - 1; i >= 0 && len(worst) < rankedDishLimit; i-- {
		worst = append(worst, rated[i])
	}

	return rankedDishes{best: best, worst: worst}
}

// average guards the zero-review case rather than dividing by it.
func average(sum, count int64) float64 {
	if count <= 0 {
		return 0
	}
	return float64(sum) / float64(count)
}
