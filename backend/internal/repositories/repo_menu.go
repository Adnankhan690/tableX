package repositories

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"tablex/internal/models"
)

// Conventions shared by every method in this file, stated once rather than repeated on
// each one:
//
//   - Errors are wrapped with %w, never replaced. Whether a missing menu item is a 404 or
//     an expected absence is the service's call, and errors.Is only reaches the sentinel
//     if the wrap preserves it.
//   - A missing row is not logged here. Only the caller knows whether it matters, and
//     logging at this depth turns every probe for an unknown uid into error-stream noise.
//   - Listings are ordered sort_order then name (orderBySortThenName). A menu runs
//     Starters before Desserts, which is neither alphabetical nor insertion order, and
//     name breaks the tie so two rows sharing a sort_order cannot swap places between
//     requests -- a menu that reshuffles on refresh reads as a broken page.
//   - A read of one item preloads its Category; a read of many does not. Every
//     single-item admin response carries category_uid, so the preload saves the service a
//     round trip, while the list paths already hold every category and the cart path has
//     no use for them.

// repositoryMenu is data access for categories and items.
type repositoryMenu struct {
	*RepositoryAccess
}

// NewRepositoryMenu builds the menu repository over the shared Access.
func NewRepositoryMenu(access *RepositoryAccess) RepositoryMenuMethods {
	return &repositoryMenu{RepositoryAccess: access}
}

// CreateCategory inserts a category, inside the caller's transaction when there is one.
//
// A unique violation on (restaurant_id, name) is an expected error here rather than a bug:
// CategoryNameExists only narrows the window between two managers adding "Desserts" at the
// same moment, and the index is what closes it.
func (a *repositoryMenu) CreateCategory(ctx context.Context, tx *gorm.DB, category *models.MenuCategory) error {
	if err := a.conn(tx).WithContext(ctx).Create(category).Error; err != nil {
		a.Logger.With(ctx).Errorf("[CreateCategory] restaurant=%d name=%q: %v", category.RestaurantID, category.Name, err)
		return fmt.Errorf("create menu category: %w", err)
	}
	return nil
}

func (a *repositoryMenu) GetCategoryByID(ctx context.Context, restaurantID, id int32) (*models.MenuCategory, error) {
	var category models.MenuCategory
	if err := a.conn(nil).WithContext(ctx).Where(whereRestaurantAndID, restaurantID, id).First(&category).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetCategoryByID] restaurant=%d id=%d: %v", restaurantID, id, err)
		}
		return nil, fmt.Errorf("get menu category by id: %w", err)
	}
	return &category, nil
}

// GetCategoryByUID keeps restaurant_id in the WHERE even though uid is globally unique: a
// uid leaked from another tenant must read as "no such category" rather than resolving to
// somebody else's row (DECISIONS.md D3).
func (a *repositoryMenu) GetCategoryByUID(ctx context.Context, restaurantID int32, uid string) (*models.MenuCategory, error) {
	var category models.MenuCategory
	if err := a.conn(nil).WithContext(ctx).Where(whereRestaurantAndUID, restaurantID, uid).First(&category).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetCategoryByUID] restaurant=%d uid=%q: %v", restaurantID, uid, err)
		}
		return nil, fmt.Errorf("get menu category by uid: %w", err)
	}
	return &category, nil
}

// ListCategories returns one restaurant's categories in display order.
//
// includeInactive is the admin/diner split: the diner menu asks for active rows only, the
// admin panel asks for everything so a manager can find the category they hid last week
// and unhide it.
//
// Items are not preloaded. The menu service pairs this with ListItems and groups them in
// memory, which is two queries for the entire menu instead of one per category -- PRD 7
// makes menu latency on 3G a product requirement, and round trips are what costs there.
func (a *repositoryMenu) ListCategories(ctx context.Context, restaurantID int32, includeInactive bool) ([]*models.MenuCategory, error) {
	q := a.conn(nil).WithContext(ctx).Where(whereRestaurant, restaurantID)
	if !includeInactive {
		q = q.Where("status = ?", models.EntityStatusActive)
	}

	var categories []*models.MenuCategory
	if err := q.Order(orderBySortThenName).Find(&categories).Error; err != nil {
		a.Logger.With(ctx).Errorf("[ListCategories] restaurant=%d: %v", restaurantID, err)
		return nil, fmt.Errorf("list menu categories: %w", err)
	}
	return categories, nil
}

// UpdateCategoryFields applies a patch and returns the stored row.
//
// Scoped by id alone, as the interface declares: the caller resolved this id through a
// restaurant-scoped read, and re-checking the tenant here would imply it had not.
func (a *repositoryMenu) UpdateCategoryFields(ctx context.Context, id int32, fields map[string]any) (*models.MenuCategory, error) {
	// An empty patch reads the row back instead of issuing an UPDATE, which would touch
	// nothing but updated_at and make a no-op PATCH look like an edit in the row's history.
	if len(fields) > 0 {
		res := a.conn(nil).WithContext(ctx).Model(&models.MenuCategory{}).Where(whereID, id).Updates(fields)
		if res.Error != nil {
			a.Logger.With(ctx).Errorf("[UpdateCategoryFields] id=%d: %v", id, res.Error)
			return nil, fmt.Errorf("update menu category fields: %w", res.Error)
		}
		if res.RowsAffected == 0 {
			// The row was resolved moments ago, so zero rows means it was deleted in
			// between. Reported with the sentinel a read would have returned, so the
			// service has one mapping to write rather than a second for "updated nothing".
			return nil, fmt.Errorf("update menu category fields: %w", gorm.ErrRecordNotFound)
		}
	}

	// Re-read rather than echoing the patch back: the caller renders this straight to the
	// admin screen and needs the columns the update did not touch, plus the new updated_at.
	var category models.MenuCategory
	if err := a.conn(nil).WithContext(ctx).Where(whereID, id).First(&category).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[UpdateCategoryFields] reread id=%d: %v", id, err)
		}
		return nil, fmt.Errorf("update menu category fields: %w", err)
	}
	return &category, nil
}

// CategoryNameExists is advisory, not the guarantee -- it exists so a duplicate name comes
// back as a readable 409 instead of a constraint violation.
//
// Compared case-insensitively, deliberately stricter than the exact-match unique index on
// (restaurant_id, name): "Starters" and "starters" side by side is a bug the diner sees,
// and the database would happily allow it. The cost is that this comparison cannot use the
// index, which is affordable on a per-restaurant category list and would not be on a large
// table.
//
// Status is not filtered, because an archived category still occupies its name in the
// index. Ignoring that would let the service promise a create that Postgres then rejects.
func (a *repositoryMenu) CategoryNameExists(ctx context.Context, restaurantID int32, name string, excludeID int32) (bool, error) {
	q := a.conn(nil).WithContext(ctx).Model(&models.MenuCategory{}).
		Where(whereRestaurant, restaurantID).
		Where("LOWER(name) = LOWER(?)", name)
	// excludeID is the row being edited, so a category that keeps its own name through an
	// update does not collide with itself. Zero means there is no row to exclude yet.
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}

	var count int64
	if err := q.Count(&count).Error; err != nil {
		a.Logger.With(ctx).Errorf("[CategoryNameExists] restaurant=%d name=%q: %v", restaurantID, name, err)
		return false, fmt.Errorf("check menu category name: %w", err)
	}
	return count > 0, nil
}

// CountItemsInCategory backs the guard against archiving a category that still has items.
//
// With includeArchived false this still counts inactive items, because a hidden dish is
// one the manager intends to bring back: archiving its category out from under it would
// leave the item pointing at something the menu no longer shows. Only archived items are
// genuinely finished with.
//
// Not restaurant-scoped, as the interface declares -- categoryID came from a scoped read.
func (a *repositoryMenu) CountItemsInCategory(ctx context.Context, categoryID int32, includeArchived bool) (int64, error) {
	q := a.conn(nil).WithContext(ctx).Model(&models.MenuItem{}).Where("category_id = ?", categoryID)
	if !includeArchived {
		q = q.Where("status <> ?", models.EntityStatusArchived)
	}

	var count int64
	if err := q.Count(&count).Error; err != nil {
		a.Logger.With(ctx).Errorf("[CountItemsInCategory] category=%d: %v", categoryID, err)
		return 0, fmt.Errorf("count menu items in category: %w", err)
	}
	return count, nil
}

// CreateItem inserts a dish. As with CreateCategory, the unique index on
// (restaurant_id, category_id, name) is the authority on duplicates.
func (a *repositoryMenu) CreateItem(ctx context.Context, tx *gorm.DB, item *models.MenuItem) error {
	if err := a.conn(tx).WithContext(ctx).Create(item).Error; err != nil {
		a.Logger.With(ctx).Errorf("[CreateItem] restaurant=%d category=%d name=%q: %v", item.RestaurantID, item.CategoryID, item.Name, err)
		return fmt.Errorf("create menu item: %w", err)
	}
	return nil
}

func (a *repositoryMenu) GetItemByID(ctx context.Context, restaurantID, id int32) (*models.MenuItem, error) {
	var item models.MenuItem
	err := a.conn(nil).WithContext(ctx).
		Preload("Category").
		Where(whereRestaurantAndID, restaurantID, id).
		First(&item).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetItemByID] restaurant=%d id=%d: %v", restaurantID, id, err)
		}
		return nil, fmt.Errorf("get menu item by id: %w", err)
	}
	return &item, nil
}

func (a *repositoryMenu) GetItemByUID(ctx context.Context, restaurantID int32, uid string) (*models.MenuItem, error) {
	var item models.MenuItem
	err := a.conn(nil).WithContext(ctx).
		Preload("Category").
		Where(whereRestaurantAndUID, restaurantID, uid).
		First(&item).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetItemByUID] restaurant=%d uid=%q: %v", restaurantID, uid, err)
		}
		return nil, fmt.Errorf("get menu item by uid: %w", err)
	}
	return &item, nil
}

// GetItemsByUIDs prices a whole cart in one statement.
//
// One query, never one per line, and the second reason matters more than the first: N
// round trips on the checkout path is merely slow, but N separate reads also observe N
// different points in time, so a manager repricing paneer tikka mid-checkout could land on
// half the cart and produce a total that matches no menu that ever existed (DECISIONS.md
// D7, D8). It takes a tx because order placement calls it inside the placement
// transaction, so the prices read here are the prices the committed order was built from.
//
// Nothing is filtered by status or availability. The service has to tell "there is no such
// dish" apart from "we ran out tonight" to answer the diner correctly, and filtering here
// would collapse both into a line that silently vanished from the order -- the worst
// outcome available. Rows come back in whatever order the database chooses, and there may
// be fewer than there are uids, so the caller matches by uid and never by position.
func (a *repositoryMenu) GetItemsByUIDs(ctx context.Context, tx *gorm.DB, restaurantID int32, uids []string) ([]*models.MenuItem, error) {
	// An empty cart is not a question for the database. Returning early also avoids GORM
	// rendering "uid IN (NULL)", a round trip that can only ever come back empty.
	if len(uids) == 0 {
		return []*models.MenuItem{}, nil
	}

	var items []*models.MenuItem
	err := a.conn(tx).WithContext(ctx).
		Where(whereRestaurant, restaurantID).
		Where("uid IN ?", uids).
		Find(&items).Error
	if err != nil {
		a.Logger.With(ctx).Errorf("[GetItemsByUIDs] restaurant=%d count=%d: %v", restaurantID, len(uids), err)
		return nil, fmt.Errorf("get menu items by uids: %w", err)
	}
	return items, nil
}

// ListItems returns every item for a restaurant, flat, in display order.
//
// Flat rather than nested per category: the caller groups it against ListCategories, which
// holds the whole menu at two queries however many categories a restaurant has.
//
// includeInactive gates the lifecycle flag only. Sold-out items are always returned,
// because the diner menu greys them out in place -- a dish that disappears looks like a
// broken page, one marked unavailable looks like a restaurant that ran out (PRD 6.2).
func (a *repositoryMenu) ListItems(ctx context.Context, restaurantID int32, includeInactive bool) ([]*models.MenuItem, error) {
	q := a.conn(nil).WithContext(ctx).Where(whereRestaurant, restaurantID)
	if !includeInactive {
		q = q.Where("status = ?", models.EntityStatusActive)
	}

	var items []*models.MenuItem
	if err := q.Order(orderBySortThenName).Find(&items).Error; err != nil {
		a.Logger.With(ctx).Errorf("[ListItems] restaurant=%d: %v", restaurantID, err)
		return nil, fmt.Errorf("list menu items: %w", err)
	}
	return items, nil
}

// UpdateItemFields applies a patch and returns the stored row with its category. Scoped by
// id alone for the same reason as UpdateCategoryFields.
func (a *repositoryMenu) UpdateItemFields(ctx context.Context, id int32, fields map[string]any) (*models.MenuItem, error) {
	if len(fields) > 0 {
		res := a.conn(nil).WithContext(ctx).Model(&models.MenuItem{}).Where(whereID, id).Updates(fields)
		if res.Error != nil {
			a.Logger.With(ctx).Errorf("[UpdateItemFields] id=%d: %v", id, res.Error)
			return nil, fmt.Errorf("update menu item fields: %w", res.Error)
		}
		if res.RowsAffected == 0 {
			return nil, fmt.Errorf("update menu item fields: %w", gorm.ErrRecordNotFound)
		}
	}

	var item models.MenuItem
	err := a.conn(nil).WithContext(ctx).
		Preload("Category").
		Where(whereID, id).
		First(&item).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[UpdateItemFields] reread id=%d: %v", id, err)
		}
		return nil, fmt.Errorf("update menu item fields: %w", err)
	}
	return &item, nil
}

// ItemNameExists mirrors the unique index on (restaurant_id, category_id, name): the same
// name in two categories is legitimate ("Water" under Drinks and under Extras), so the
// category is part of the question. Case handling, excludeID and the absence of a status
// filter are as CategoryNameExists.
func (a *repositoryMenu) ItemNameExists(ctx context.Context, restaurantID, categoryID int32, name string, excludeID int32) (bool, error) {
	q := a.conn(nil).WithContext(ctx).Model(&models.MenuItem{}).
		Where(whereRestaurant, restaurantID).
		Where("category_id = ?", categoryID).
		Where("LOWER(name) = LOWER(?)", name)
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}

	var count int64
	if err := q.Count(&count).Error; err != nil {
		a.Logger.With(ctx).Errorf("[ItemNameExists] restaurant=%d category=%d name=%q: %v", restaurantID, categoryID, name, err)
		return false, fmt.Errorf("check menu item name: %w", err)
	}
	return count > 0, nil
}

// SetAvailability is the one-tap sold-out toggle staff use mid-service.
//
// Restaurant-scoped in the statement itself, unlike the generic UpdateItemFields. This is
// the write reached fastest in the whole product -- one tap, id straight off the screen --
// so the tenant check belongs in the WHERE, where a request aimed at another restaurant's
// item updates nothing at all instead of depending on a caller having checked first
// (DECISIONS.md D3).
//
// It writes the single column rather than saving a struct, so marking a dish sold out can
// never carry a stale price along with it from a form somebody left open (PRD 6.2).
func (a *repositoryMenu) SetAvailability(ctx context.Context, restaurantID, id int32, available bool) (*models.MenuItem, error) {
	res := a.conn(nil).WithContext(ctx).Model(&models.MenuItem{}).
		Where(whereRestaurantAndID, restaurantID, id).
		Update("is_available", available)
	if res.Error != nil {
		a.Logger.With(ctx).Errorf("[SetAvailability] restaurant=%d id=%d: %v", restaurantID, id, res.Error)
		return nil, fmt.Errorf("set menu item availability: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		// No such item for this restaurant: it either never existed or belongs to someone
		// else, and the service must answer both identically. This is an absence check, not
		// a change check -- Postgres and SQLite report rows matched, so re-marking an
		// already-unavailable dish still counts as one row.
		return nil, fmt.Errorf("set menu item availability: %w", gorm.ErrRecordNotFound)
	}

	var item models.MenuItem
	err := a.conn(nil).WithContext(ctx).
		Preload("Category").
		Where(whereRestaurantAndID, restaurantID, id).
		First(&item).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[SetAvailability] reread restaurant=%d id=%d: %v", restaurantID, id, err)
		}
		return nil, fmt.Errorf("set menu item availability: %w", err)
	}
	return &item, nil
}

// AdjustRating moves a dish's review aggregate by a delta.
//
// The arithmetic is in SQL, not Go, and that is the whole point of the method. The obvious
// implementation -- read rating_count and rating_sum, add in Go, write them back -- is a
// read-modify-write: two diners rating the same dish in the same second each read the same
// starting value, and whichever writes second silently discards the other's rating. Expressed
// as `rating_sum = rating_sum + ?` the database serialises the two updates and both land.
//
// Correct only inside the transaction that wrote the review, which is why tx is not optional
// in practice: a committed review whose counters never moved is a permanently wrong average
// with nothing left to point at.
func (a *repositoryMenu) AdjustRating(
	ctx context.Context, tx *gorm.DB, menuItemID int32, countDelta int, sumDelta int64,
) error {
	if countDelta == 0 && sumDelta == 0 {
		// A diner re-tapping the star they already gave. Nothing to move, and an UPDATE with
		// an empty SET is a syntax error.
		return nil
	}

	res := a.conn(tx).WithContext(ctx).Model(&models.MenuItem{}).
		Where(whereID, menuItemID).
		Updates(map[string]any{
			"rating_count": gorm.Expr("rating_count + ?", countDelta),
			"rating_sum":   gorm.Expr("rating_sum + ?", sumDelta),
		})
	if res.Error != nil {
		return fmt.Errorf("adjust menu item rating id=%d: %w", menuItemID, res.Error)
	}
	if res.RowsAffected == 0 {
		// The dish vanished between the order line being written and this review. Reported
		// rather than swallowed: the caller is inside a transaction that must roll back, or
		// the review would commit against counters that never moved.
		return fmt.Errorf("adjust menu item rating id=%d: %w", menuItemID, gorm.ErrRecordNotFound)
	}
	return nil
}
