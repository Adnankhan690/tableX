package repositories

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"tablex/internal/models"
)

// Conventions shared by every method in this file, stated once rather than repeated as a
// comment on each one:
//
//   - Errors are wrapped with %w, never replaced. The service layer decides what
//     gorm.ErrRecordNotFound means for a given call, and errors.Is only reaches it if the
//     sentinel survives the wrap.
//   - A missing row is not logged here. Only the caller knows whether it is a 404 or an
//     expected absence, and logging it at this depth turns every probe for an unknown slug
//     into noise in the error stream.
//   - WithContext is applied on every query so a cancelled request -- a diner closing the
//     tab mid-scan -- releases the connection instead of holding it to completion.

// repositoryRestaurant is data access for the tenant root.
type repositoryRestaurant struct {
	*RepositoryAccess
}

// NewRepositoryRestaurant builds the restaurant repository over the shared Access.
func NewRepositoryRestaurant(access *RepositoryAccess) RepositoryRestaurantMethods {
	return &repositoryRestaurant{RepositoryAccess: access}
}

func (a *repositoryRestaurant) Create(ctx context.Context, tx *gorm.DB, restaurant *models.Restaurant) error {
	if err := a.conn(tx).WithContext(ctx).Create(restaurant).Error; err != nil {
		a.Logger.With(ctx).Errorf("[Create] restaurant slug=%q: %v", restaurant.Slug, err)
		return fmt.Errorf("create restaurant: %w", err)
	}
	return nil
}

func (a *repositoryRestaurant) GetByID(ctx context.Context, id int32) (*models.Restaurant, error) {
	var restaurant models.Restaurant
	if err := a.conn(nil).WithContext(ctx).Where(whereID, id).First(&restaurant).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetByID] restaurant id=%d: %v", id, err)
		}
		return nil, fmt.Errorf("get restaurant by id: %w", err)
	}
	return &restaurant, nil
}

func (a *repositoryRestaurant) GetByUID(ctx context.Context, uid string) (*models.Restaurant, error) {
	var restaurant models.Restaurant
	if err := a.conn(nil).WithContext(ctx).Where(whereUID, uid).First(&restaurant).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetByUID] restaurant uid=%q: %v", uid, err)
		}
		return nil, fmt.Errorf("get restaurant by uid: %w", err)
	}
	return &restaurant, nil
}

func (a *repositoryRestaurant) GetBySlug(ctx context.Context, slug string) (*models.Restaurant, error) {
	var restaurant models.Restaurant
	if err := a.conn(nil).WithContext(ctx).Where("slug = ?", slug).First(&restaurant).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetBySlug] restaurant slug=%q: %v", slug, err)
		}
		return nil, fmt.Errorf("get restaurant by slug: %w", err)
	}
	return &restaurant, nil
}

func (a *repositoryRestaurant) UpdateFields(ctx context.Context, id int32, fields map[string]any) (*models.Restaurant, error) {
	// An empty patch reads the row back instead of issuing an UPDATE. GORM builds no
	// statement at all for an empty assignment map and leaves RowsAffected at zero, so the
	// not-found check below would report a PATCH that changed nothing as a missing
	// restaurant.
	if len(fields) == 0 {
		return a.GetByID(ctx, id)
	}

	res := a.conn(nil).WithContext(ctx).Model(&models.Restaurant{}).Where(whereID, id).Updates(fields)
	if res.Error != nil {
		a.Logger.With(ctx).Errorf("[UpdateFields] restaurant id=%d: %v", id, res.Error)
		return nil, fmt.Errorf("update restaurant fields: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		// Report the same sentinel a read would, so the service has one mapping to write
		// rather than a second one for "updated nothing".
		return nil, fmt.Errorf("update restaurant fields: %w", gorm.ErrRecordNotFound)
	}

	// Re-read rather than returning the patch echoed back: the caller renders this straight
	// to the settings screen, and the row also carries the columns the update did not touch
	// plus the refreshed updated_at.
	return a.GetByID(ctx, id)
}

// SlugExists is advisory, not the guarantee. It exists so a taken slug comes back as a
// readable 409 instead of a constraint violation; the unique index on restaurant.slug is
// what actually holds when two creates race.
func (a *repositoryRestaurant) SlugExists(ctx context.Context, slug string, excludeID int32) (bool, error) {
	q := a.conn(nil).WithContext(ctx).Model(&models.Restaurant{}).Where("slug = ?", slug)
	// excludeID is the row being edited, so a restaurant that keeps its own slug through an
	// update does not collide with itself. Zero means there is no row to exclude yet.
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}

	var count int64
	if err := q.Count(&count).Error; err != nil {
		a.Logger.With(ctx).Errorf("[SlugExists] slug=%q: %v", slug, err)
		return false, fmt.Errorf("count restaurants by slug: %w", err)
	}
	return count > 0, nil
}

// List is platform-wide and takes no restaurantID because it has no tenant to scope to:
// it serves operator tooling -- seeding, support lookups -- not any tenant-facing route.
// Nothing reachable from a staff or diner token calls it (DECISIONS.md D3).
func (a *repositoryRestaurant) List(ctx context.Context) ([]*models.Restaurant, error) {
	var restaurants []*models.Restaurant
	// Find, so an empty platform is an empty slice rather than an error the caller has to
	// distinguish from a real failure.
	if err := a.conn(nil).WithContext(ctx).Order("name ASC").Find(&restaurants).Error; err != nil {
		a.Logger.With(ctx).Errorf("[List] restaurants: %v", err)
		return nil, fmt.Errorf("list restaurants: %w", err)
	}
	return restaurants, nil
}
