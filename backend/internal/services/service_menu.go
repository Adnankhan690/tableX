package services

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"tablex/internal/models"
	"tablex/internal/response"
	"tablex/internal/types"
	"tablex/internal/utils"
)

type serviceMenu struct {
	Access *ServiceAccess
}

// NewServiceMenu builds the catalogue service.
func NewServiceMenu(access *ServiceAccess) ServiceMenuMethods {
	return &serviceMenu{Access: access}
}

// loadPublicMenu assembles the diner menu for a restaurant.
//
// Package-level rather than a method so the session service can call it during a QR scan
// without taking a dependency on the menu service -- the scan response carries the whole
// menu, and duplicating this assembly in two places is how the two would drift.
//
// Exactly two queries: categories, then items. Never one item query per category, because on
// a 3G connection the round trips cost more than the bytes do (PRD 7).
func loadPublicMenu(
	ctx context.Context,
	access *ServiceAccess,
	restaurant *models.Restaurant,
) (*types.ResponseMenu, *response.ApplicationError) {
	log := access.Logger.With(ctx)

	categories, err := access.Repositories.Menu.ListCategories(ctx, restaurant.ID, false)
	if err != nil {
		log.Errorf("[loadPublicMenu] categories failed for restaurant %d: %+v", restaurant.ID, err)
		return nil, response.ErrMenuFetchFailed
	}

	items, err := access.Repositories.Menu.ListItems(ctx, restaurant.ID, false)
	if err != nil {
		log.Errorf("[loadPublicMenu] items failed for restaurant %d: %+v", restaurant.ID, err)
		return nil, response.ErrMenuFetchFailed
	}

	return buildPublicMenu(restaurant, categories, items), nil
}

func (s *serviceMenu) GetPublicMenu(
	ctx context.Context,
	restaurantID int32,
) (*types.ResponseMenu, *response.ApplicationError) {
	restaurant, appErr := loadActiveRestaurant(ctx, s.Access, restaurantID)
	if appErr != nil {
		return nil, appErr
	}
	return loadPublicMenu(ctx, s.Access, restaurant)
}

func (s *serviceMenu) GetAdminMenu(
	ctx context.Context,
	actor *StaffPrincipal,
) (*types.ResponseAdminMenu, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	restaurant, err := s.Access.Repositories.Restaurant.GetByID(ctx, actor.RestaurantID)
	if err != nil {
		log.Errorf("[GetAdminMenu] restaurant lookup failed: %+v", err)
		return nil, response.ErrRestaurantFetchFailed
	}

	// includeInactive is true here and false on the public path: staff need to see and
	// un-archive what a diner must never be offered.
	categories, err := s.Access.Repositories.Menu.ListCategories(ctx, actor.RestaurantID, true)
	if err != nil {
		log.Errorf("[GetAdminMenu] categories failed: %+v", err)
		return nil, response.ErrMenuFetchFailed
	}
	items, err := s.Access.Repositories.Menu.ListItems(ctx, actor.RestaurantID, true)
	if err != nil {
		log.Errorf("[GetAdminMenu] items failed: %+v", err)
		return nil, response.ErrMenuFetchFailed
	}

	idToUID := make(map[int32]string, len(categories))
	for _, c := range categories {
		idToUID[c.ID] = c.UID
	}

	byCategory := make(map[string][]types.AdminMenuItemView, len(categories))
	for _, item := range items {
		uid, ok := idToUID[item.CategoryID]
		if !ok {
			continue
		}
		byCategory[uid] = append(byCategory[uid], toAdminMenuItemView(item, uid, restaurant.Currency))
	}

	views := make([]types.AdminMenuCategoryView, 0, len(categories))
	for _, c := range categories {
		// Empty categories are kept on the admin view, unlike the diner view: an empty
		// category is exactly what a manager is looking at when they are about to fill it.
		views = append(views, types.AdminMenuCategoryView{
			UID:         c.UID,
			Name:        c.Name,
			Description: c.Description,
			SortOrder:   c.SortOrder,
			Status:      string(c.Status),
			Items:       byCategory[c.UID],
		})
	}

	return &types.ResponseAdminMenu{Categories: views}, nil
}

func (s *serviceMenu) CreateCategory(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestCreateCategory,
) (*types.AdminMenuCategoryView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}

	name := strings.TrimSpace(req.Name)
	taken, err := s.Access.Repositories.Menu.CategoryNameExists(ctx, actor.RestaurantID, name, 0)
	if err != nil {
		log.Errorf("[CreateCategory] name check failed: %+v", err)
		return nil, response.ErrCategoryCreateFailed
	}
	if taken {
		return nil, response.ErrCategoryNameTaken
	}

	category := &models.MenuCategory{
		UID:          utils.GenerateUID(utils.UIDPrefixCategory),
		RestaurantID: actor.RestaurantID,
		Name:         name,
		Description:  strings.TrimSpace(req.Description),
		SortOrder:    req.SortOrder,
		Status:       models.EntityStatusActive,
	}

	if err := s.Access.Repositories.Menu.CreateCategory(ctx, nil, category); err != nil {
		log.Errorf("[CreateCategory] insert failed: %+v", err)
		return nil, response.ErrCategoryCreateFailed
	}

	log.Infof("[CreateCategory] created %s (%q)", category.UID, category.Name)

	return &types.AdminMenuCategoryView{
		UID:         category.UID,
		Name:        category.Name,
		Description: category.Description,
		SortOrder:   category.SortOrder,
		Status:      string(category.Status),
		Items:       []types.AdminMenuItemView{},
	}, nil
}

func (s *serviceMenu) UpdateCategory(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
	req *types.RequestUpdateCategory,
) (*types.AdminMenuCategoryView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}

	category, err := s.Access.Repositories.Menu.GetCategoryByUID(ctx, actor.RestaurantID, uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrCategoryNotFound
		}
		log.Errorf("[UpdateCategory] lookup failed: %+v", err)
		return nil, response.ErrCategoryUpdateFailed
	}

	fields := map[string]any{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		taken, err := s.Access.Repositories.Menu.CategoryNameExists(ctx, actor.RestaurantID, name, category.ID)
		if err != nil {
			log.Errorf("[UpdateCategory] name check failed: %+v", err)
			return nil, response.ErrCategoryUpdateFailed
		}
		if taken {
			return nil, response.ErrCategoryNameTaken
		}
		fields["name"] = name
	}
	applyString(fields, "description", req.Description)
	applyInt(fields, "sort_order", req.SortOrder)

	if req.Status != nil {
		target := models.EntityStatus(*req.Status)
		// Archiving a category that still holds dishes would leave those dishes with no
		// section to render in. Refuse rather than cascade -- cascading here would delete menu
		// items that order history references.
		if target != models.EntityStatusActive {
			count, err := s.Access.Repositories.Menu.CountItemsInCategory(ctx, category.ID, false)
			if err != nil {
				log.Errorf("[UpdateCategory] item count failed: %+v", err)
				return nil, response.ErrCategoryUpdateFailed
			}
			if count > 0 {
				return nil, response.ErrCategoryHasItems
			}
		}
		fields["status"] = target
	}

	if len(fields) == 0 {
		return s.categoryView(category), nil
	}

	updated, err := s.Access.Repositories.Menu.UpdateCategoryFields(ctx, category.ID, fields)
	if err != nil {
		log.Errorf("[UpdateCategory] update failed: %+v", err)
		return nil, response.ErrCategoryUpdateFailed
	}

	return s.categoryView(updated), nil
}

func (s *serviceMenu) categoryView(c *models.MenuCategory) *types.AdminMenuCategoryView {
	return &types.AdminMenuCategoryView{
		UID:         c.UID,
		Name:        c.Name,
		Description: c.Description,
		SortOrder:   c.SortOrder,
		Status:      string(c.Status),
		Items:       []types.AdminMenuItemView{},
	}
}

func (s *serviceMenu) CreateItem(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestCreateMenuItem,
) (*types.AdminMenuItemView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}

	// The category is resolved by UID and scoped to the caller's restaurant, so a UID
	// belonging to another tenant 404s rather than silently succeeding (DECISIONS.md D3).
	category, err := s.Access.Repositories.Menu.GetCategoryByUID(ctx, actor.RestaurantID, req.CategoryUID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrCategoryNotFound
		}
		log.Errorf("[CreateItem] category lookup failed: %+v", err)
		return nil, response.ErrMenuItemCreateFailed
	}

	foodType := models.FoodType(req.FoodType)
	if !foodType.Valid() {
		return nil, response.ErrInvalidFoodType
	}
	spice := models.SpiceLevel(req.SpiceLevel)
	if !spice.Valid() {
		return nil, response.ErrInvalidSpiceLevel
	}
	if req.PriceMinor < 0 {
		return nil, response.ErrInvalidPrice
	}

	name := strings.TrimSpace(req.Name)
	taken, err := s.Access.Repositories.Menu.ItemNameExists(ctx, actor.RestaurantID, category.ID, name, 0)
	if err != nil {
		log.Errorf("[CreateItem] name check failed: %+v", err)
		return nil, response.ErrMenuItemCreateFailed
	}
	if taken {
		return nil, response.ErrMenuItemNameTaken
	}

	item := &models.MenuItem{
		UID:          utils.GenerateUID(utils.UIDPrefixMenuItem),
		RestaurantID: actor.RestaurantID,
		CategoryID:   category.ID,
		Name:         name,
		Description:  strings.TrimSpace(req.Description),
		ImageURL:     strings.TrimSpace(req.ImageURL),
		PriceMinor:   req.PriceMinor,
		FoodType:     foodType,
		SpiceLevel:   spice,
		// A new dish defaults to available: a manager adding it during service almost always
		// means it is on tonight, and the sold-out toggle is one tap away.
		IsAvailable:  req.IsAvailable == nil || *req.IsAvailable,
		IsBestseller: req.IsBestseller != nil && *req.IsBestseller,
		PrepTimeMins: req.PrepTimeMins,
		SortOrder:    req.SortOrder,
		Status:       models.EntityStatusActive,
	}

	if err := s.Access.Repositories.Menu.CreateItem(ctx, nil, item); err != nil {
		log.Errorf("[CreateItem] insert failed: %+v", err)
		return nil, response.ErrMenuItemCreateFailed
	}

	log.Infof("[CreateItem] created %s (%q) at %d paise", item.UID, item.Name, item.PriceMinor)

	view := toAdminMenuItemView(item, category.UID, "INR")
	return &view, nil
}

func (s *serviceMenu) UpdateItem(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
	req *types.RequestUpdateMenuItem,
) (*types.AdminMenuItemView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}

	item, err := s.Access.Repositories.Menu.GetItemByUID(ctx, actor.RestaurantID, uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrMenuItemNotFound
		}
		log.Errorf("[UpdateItem] lookup failed: %+v", err)
		return nil, response.ErrMenuItemUpdateFailed
	}

	categoryID := item.CategoryID
	categoryUID := ""
	if req.CategoryUID != nil {
		category, err := s.Access.Repositories.Menu.GetCategoryByUID(ctx, actor.RestaurantID, *req.CategoryUID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, response.ErrCategoryNotFound
			}
			log.Errorf("[UpdateItem] category lookup failed: %+v", err)
			return nil, response.ErrMenuItemUpdateFailed
		}
		categoryID = category.ID
		categoryUID = category.UID
	}

	fields := map[string]any{}
	if req.CategoryUID != nil {
		fields["category_id"] = categoryID
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		taken, err := s.Access.Repositories.Menu.ItemNameExists(ctx, actor.RestaurantID, categoryID, name, item.ID)
		if err != nil {
			log.Errorf("[UpdateItem] name check failed: %+v", err)
			return nil, response.ErrMenuItemUpdateFailed
		}
		if taken {
			return nil, response.ErrMenuItemNameTaken
		}
		fields["name"] = name
	}
	applyString(fields, "description", req.Description)
	applyString(fields, "image_url", req.ImageURL)
	if req.PriceMinor != nil {
		if *req.PriceMinor < 0 {
			return nil, response.ErrInvalidPrice
		}
		applyInt64(fields, "price_minor", req.PriceMinor)
	}
	if req.FoodType != nil {
		foodType := models.FoodType(*req.FoodType)
		if !foodType.Valid() {
			return nil, response.ErrInvalidFoodType
		}
		fields["food_type"] = foodType
	}
	if req.SpiceLevel != nil {
		spice := models.SpiceLevel(*req.SpiceLevel)
		if !spice.Valid() {
			return nil, response.ErrInvalidSpiceLevel
		}
		fields["spice_level"] = spice
	}
	applyBool(fields, "is_available", req.IsAvailable)
	applyBool(fields, "is_bestseller", req.IsBestseller)
	if req.PrepTimeMins != nil {
		fields["prep_time_mins"] = *req.PrepTimeMins
	}
	applyInt(fields, "sort_order", req.SortOrder)
	if req.Status != nil {
		fields["status"] = models.EntityStatus(*req.Status)
	}

	if len(fields) == 0 {
		view := toAdminMenuItemView(item, categoryUID, "INR")
		return &view, nil
	}

	updated, err := s.Access.Repositories.Menu.UpdateItemFields(ctx, item.ID, fields)
	if err != nil {
		log.Errorf("[UpdateItem] update failed: %+v", err)
		return nil, response.ErrMenuItemUpdateFailed
	}

	// An availability change made through the full-update path still needs to reach open
	// diner carts, exactly as the fast path does.
	if req.IsAvailable != nil {
		s.publishAvailability(actor.RestaurantUID)
	}

	view := toAdminMenuItemView(updated, categoryUID, "INR")
	return &view, nil
}

// SetAvailability is the fast mid-service path: one field, one tap.
//
// Separate from UpdateItem so that marking a dish sold out cannot accidentally submit a stale
// price from an edit form a manager left open in another tab -- and so it can be granted to
// every staff role while repricing stays with owners and managers.
func (s *serviceMenu) SetAvailability(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
	req *types.RequestSetAvailability,
) (*types.AdminMenuItemView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	item, err := s.Access.Repositories.Menu.GetItemByUID(ctx, actor.RestaurantID, uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrMenuItemNotFound
		}
		log.Errorf("[SetAvailability] lookup failed: %+v", err)
		return nil, response.ErrMenuItemUpdateFailed
	}

	updated, err := s.Access.Repositories.Menu.SetAvailability(ctx, actor.RestaurantID, item.ID, req.IsAvailable)
	if err != nil {
		log.Errorf("[SetAvailability] update failed for %s: %+v", uid, err)
		return nil, response.ErrMenuItemUpdateFailed
	}

	log.Infof("[SetAvailability] %s is_available=%v by %s", uid, req.IsAvailable, actor.StaffUID)

	// Tell open diner carts before checkout rather than rejecting them at it. A diner who
	// discovers a dish is gone while still on the menu can pick something else; one who
	// discovers it at the payment screen has to start over.
	s.publishAvailability(actor.RestaurantUID)

	view := toAdminMenuItemView(updated, "", "INR")
	return &view, nil
}

// publishAvailability notifies diners that the menu changed. Best-effort: the write is
// already committed, and clients refetch (DECISIONS.md D10).
func (s *serviceMenu) publishAvailability(restaurantUID string) {
	s.Access.publishOrderEvent(types.EventMenuItemAvailability, restaurantUID, "", "", "")
}

// loadActiveRestaurant fetches a restaurant and refuses if it is not taking orders.
//
// Shared by the menu, session and order paths, all of which must stop a diner ordering from
// a restaurant that has been deactivated mid-service.
func loadActiveRestaurant(
	ctx context.Context,
	access *ServiceAccess,
	restaurantID int32,
) (*models.Restaurant, *response.ApplicationError) {
	restaurant, err := access.Repositories.Restaurant.GetByID(ctx, restaurantID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrRestaurantNotFound
		}
		access.Logger.With(ctx).Errorf("[loadActiveRestaurant] %d: %+v", restaurantID, err)
		return nil, response.ErrRestaurantFetchFailed
	}
	if restaurant.Status != models.EntityStatusActive {
		return nil, response.ErrRestaurantInactive
	}
	return restaurant, nil
}
