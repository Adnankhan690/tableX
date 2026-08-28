package services

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"tablex/internal/models"
	"tablex/internal/response"
	"tablex/internal/storage"
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

	return buildPublicMenu(restaurant, categories, items, access.Storage), nil
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
		byCategory[uid] = append(byCategory[uid], toAdminMenuItemView(item, uid, restaurant.Currency, s.Access.Storage))
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

	uploadsEnabled := s.Access.Storage.Configured()
	maxUploadBytes := int64(0)
	if uploadsEnabled {
		maxUploadBytes = s.Access.Cfg.Storage.MaxUploadBytes
	}

	return &types.ResponseAdminMenu{
		Categories:          views,
		ImageUploadEnabled:  uploadsEnabled,
		ImageMaxUploadBytes: maxUploadBytes,
	}, nil
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

	view := toAdminMenuItemView(item, category.UID, "INR", s.Access.Storage)
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

	// Supplying image_url through the PATCH path means "this dish's photo is now THIS URL",
	// so an uploaded photo it would otherwise sit behind has to go (DECISIONS.md D15).
	//
	// Without this, a manager who pastes a URL over an uploaded photo gets a 200 and no
	// change: menuItemImageURL prefers image_key, so the value they just set would be
	// ignored and the old photograph would keep rendering. Clearing the key is what makes
	// the two ways of setting a photo one field rather than two competing ones.
	//
	// It covers the clearing case too -- image_url of "" means "no photo", and leaving an
	// image_key behind would make that a no-op as well.
	supersededKey := ""
	if req.ImageURL != nil {
		applyString(fields, "image_url", req.ImageURL)
		fields["image_key"] = ""
		supersededKey = item.ImageKey
	}
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
		view := toAdminMenuItemView(item, categoryUID, "INR", s.Access.Storage)
		return &view, nil
	}

	updated, err := s.Access.Repositories.Menu.UpdateItemFields(ctx, item.ID, fields)
	if err != nil {
		log.Errorf("[UpdateItem] update failed: %+v", err)
		return nil, response.ErrMenuItemUpdateFailed
	}

	// After the write, for the same reason the image paths below do it after theirs: the
	// row no longer references this object, and deleting before a failed update would strand
	// the dish pointing at bytes that are gone.
	s.discardSupersededImage(ctx, supersededKey, "")

	// An availability change made through the full-update path still needs to reach open
	// diner carts, exactly as the fast path does.
	if req.IsAvailable != nil {
		s.publishAvailability(actor.RestaurantUID)
	}

	view := toAdminMenuItemView(updated, categoryUID, "INR", s.Access.Storage)
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

	view := toAdminMenuItemView(updated, "", "INR", s.Access.Storage)
	return &view, nil
}

// publishAvailability notifies diners that the menu changed. Best-effort: the write is
// already committed, and clients refetch (DECISIONS.md D10).
func (s *serviceMenu) publishAvailability(restaurantUID string) {
	s.Access.publishOrderEvent(types.EventMenuItemAvailability, restaurantUID, "", "", "")
}

// --- Dish photographs (DECISIONS.md D15) ---
//
// Two calls, and the split is the safety design rather than an API-shape preference.
//
// CreateImageUpload mints a presigned URL; the browser PUTs the bytes straight to R2, so a
// 5 MB photograph never occupies a request worker on a 512 MB instance. But at the moment
// that URL is issued there is nothing to inspect -- only a claim about what is coming. So
// ConfirmImageUpload is where the checks live: it measures the object that actually landed
// and sniffs its leading bytes, and only then does the key reach the database.

// CreateImageUpload mints a presigned URL for one photograph of one dish.
func (s *serviceMenu) CreateImageUpload(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
	req *types.RequestCreateImageUpload,
) (*types.ResponseImageUpload, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}
	if !s.Access.Storage.Configured() {
		return nil, response.ErrImageUploadsDisabled
	}

	contentType := req.ContentType
	if _, ok := storage.ExtensionFor(contentType); !ok {
		return nil, response.ErrImageTypeUnsupported
	}

	maxBytes := s.Access.Cfg.Storage.MaxUploadBytes
	if req.SizeBytes <= 0 || req.SizeBytes > maxBytes {
		return nil, response.ErrImageTooLarge
	}

	// Scoped to the caller's restaurant, so a uid belonging to another tenant 404s here
	// rather than yielding a signed URL into our bucket (DECISIONS.md D3).
	item, err := s.Access.Repositories.Menu.GetItemByUID(ctx, actor.RestaurantID, uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrMenuItemNotFound
		}
		log.Errorf("[CreateImageUpload] lookup failed for %s: %+v", uid, err)
		return nil, response.ErrImageUploadFailed
	}

	// The key is built here, from the authenticated actor's restaurant and the item just
	// loaded -- never from anything the client sent. That is what makes the confirm step's
	// ownership check meaningful: the only keys in circulation are ones this line minted.
	key, err := storage.MenuItemKey(actor.RestaurantUID, item.UID, contentType)
	if err != nil {
		log.Errorf("[CreateImageUpload] key build failed for %s: %+v", item.UID, err)
		return nil, response.ErrImageUploadFailed
	}

	upload, err := s.Access.Storage.PresignPut(ctx, key, contentType, req.SizeBytes)
	if err != nil {
		log.Errorf("[CreateImageUpload] presign failed for %s: %+v", key, err)
		return nil, response.ErrImageUploadFailed
	}

	log.Infof("[CreateImageUpload] issued upload for %s (%s, %d bytes)", item.UID, contentType, req.SizeBytes)

	return &types.ResponseImageUpload{
		UploadURL: upload.URL,
		Method:    upload.Method,
		Headers:   upload.Headers,
		ObjectKey: key,
		ExpiresAt: upload.ExpiresAt,
		MaxBytes:  maxBytes,
	}, nil
}

// ConfirmImageUpload attaches a finished upload to the dish.
//
// Everything a presigned PUT cannot constrain is constrained here. A signature proves the
// client sent the length and content type it promised; it says nothing about whether those
// bytes are a photograph, which is why the object is measured and sniffed before its key is
// allowed anywhere near the database.
func (s *serviceMenu) ConfirmImageUpload(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
	req *types.RequestConfirmImageUpload,
) (*types.AdminMenuItemView, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}
	if !s.Access.Storage.Configured() {
		return nil, response.ErrImageUploadsDisabled
	}

	item, err := s.Access.Repositories.Menu.GetItemByUID(ctx, actor.RestaurantID, uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrMenuItemNotFound
		}
		log.Errorf("[ConfirmImageUpload] lookup failed for %s: %+v", uid, err)
		return nil, response.ErrImageAttachFailed
	}

	if !imageKeyBelongsTo(req.ObjectKey, actor.RestaurantUID, item.UID) {
		log.Warnf("[ConfirmImageUpload] refused key %q for item %s of restaurant %s",
			req.ObjectKey, item.UID, actor.RestaurantUID)
		return nil, response.ErrImageKeyRejected
	}

	info, err := s.Access.Storage.Head(ctx, req.ObjectKey)
	if err != nil {
		if errors.Is(err, storage.ErrObjectNotFound) {
			// The ordinary cause is a PUT that never finished, not an attack: restaurant wifi
			// drops, or the URL expired while the manager was choosing a file.
			return nil, response.ErrImageNotUploaded
		}
		log.Errorf("[ConfirmImageUpload] head failed for %s: %+v", req.ObjectKey, err)
		return nil, response.ErrImageAttachFailed
	}

	// A zero-byte object is an interrupted upload that R2 accepted as an empty PUT. It would
	// pass every later check by having nothing to fail on, and render as a broken image.
	if info.SizeBytes <= 0 {
		s.discardUpload(ctx, req.ObjectKey)
		return nil, response.ErrImageNotUploaded
	}
	if info.SizeBytes > s.Access.Cfg.Storage.MaxUploadBytes {
		// Reachable even though the length was signed: the ceiling can be lowered in config
		// between the presign and the confirm, and belt-and-braces here costs one comparison.
		s.discardUpload(ctx, req.ObjectKey)
		return nil, response.ErrImageTooLarge
	}

	head, err := s.Access.Storage.Peek(ctx, req.ObjectKey, storage.SniffBytes)
	if err != nil {
		log.Errorf("[ConfirmImageUpload] peek failed for %s: %+v", req.ObjectKey, err)
		return nil, response.ErrImageAttachFailed
	}

	// The bytes decide, not the declared type. Both halves matter: the content must BE an
	// accepted image, and it must be the one R2 will serve it as -- an HTML document stored
	// with Content-Type: image/jpeg is inert in a browser, but a mismatch means the object
	// is not what the menu thinks it is, and that is not a state worth keeping.
	detected := storage.DetectContentType(head)
	if detected == "" || !storage.SameContentType(detected, info.ContentType) {
		log.Warnf("[ConfirmImageUpload] content rejected for %s: declared %q, detected %q",
			req.ObjectKey, info.ContentType, detected)
		s.discardUpload(ctx, req.ObjectKey)
		return nil, response.ErrImageContentRejected
	}

	previousKey := item.ImageKey

	// image_url is cleared alongside. A dish that had a pasted external URL and now has an
	// uploaded photograph must not keep both: two sources for one field is how a later
	// reader picks the wrong one.
	updated, err := s.Access.Repositories.Menu.UpdateItemFields(ctx, item.ID, map[string]any{
		"image_key": req.ObjectKey,
		"image_url": "",
	})
	if err != nil {
		log.Errorf("[ConfirmImageUpload] update failed for %s: %+v", item.UID, err)
		// The object stays. Deleting it here would strand a manager who retries: the row still
		// points at the old photograph, and the new upload is the only thing that could
		// replace it.
		return nil, response.ErrImageAttachFailed
	}

	// AFTER the write, never before, and the reasoning is the same one that puts realtime
	// publishes after a commit: deleting first and then failing the update would leave the
	// row pointing at bytes that no longer exist, which is worse than an orphan.
	s.discardSupersededImage(ctx, previousKey, req.ObjectKey)

	log.Infof("[ConfirmImageUpload] %s now shows %s (%d bytes, %s)",
		item.UID, req.ObjectKey, info.SizeBytes, detected)

	view := toAdminMenuItemView(updated, "", "INR", s.Access.Storage)
	return &view, nil
}

// RemoveImage clears a dish's photograph.
//
// No Configured() check, unlike the two above. Clearing a pointer must work on a deployment
// whose storage configuration has been removed -- that is precisely when a manager is
// looking at dishes with no image and wanting to tidy the rows. The unconfigured store's
// Delete succeeds trivially, so the database write is the whole operation in that case.
func (s *serviceMenu) RemoveImage(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
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
		log.Errorf("[RemoveImage] lookup failed for %s: %+v", uid, err)
		return nil, response.ErrImageRemoveFailed
	}

	// Idempotent: a dish with no photograph is already in the requested state, and answering
	// 409 would make the admin panel's remove button fail on a double click.
	if item.ImageKey == "" && item.ImageURL == "" {
		view := toAdminMenuItemView(item, "", "INR", s.Access.Storage)
		return &view, nil
	}

	previousKey := item.ImageKey

	// Both columns, so removing a photograph does not silently reveal an older pasted URL
	// underneath it.
	updated, err := s.Access.Repositories.Menu.UpdateItemFields(ctx, item.ID, map[string]any{
		"image_key": "",
		"image_url": "",
	})
	if err != nil {
		log.Errorf("[RemoveImage] update failed for %s: %+v", item.UID, err)
		return nil, response.ErrImageRemoveFailed
	}

	s.discardSupersededImage(ctx, previousKey, "")

	log.Infof("[RemoveImage] cleared the photograph on %s", item.UID)

	view := toAdminMenuItemView(updated, "", "INR", s.Access.Storage)
	return &view, nil
}

// imageKeyBelongsTo reports whether an object key was minted for this restaurant and this
// dish.
//
// THE LOAD-BEARING AUTHORISATION CHECK ON THE CONFIRM PATH, and the reason the key encodes
// both uids at all.
//
// The key arrives from the client. Being well-formed is not enough: a well-formed key naming
// ANOTHER restaurant is exactly what would be sent to point a dish at somebody else's object,
// and a well-formed key naming another dish of the same restaurant would attach a photograph
// to the wrong item. Both uids must match what this request is authorised for.
//
// Pure, and separated from the service method for that reason -- it takes no database handle
// and no bucket, so every hostile shape can be enumerated in a test without a fixture, the
// same way the order state machine is (DECISIONS.md D1).
func imageKeyBelongsTo(key, restaurantUID, itemUID string) bool {
	keyRestaurantUID, keyItemUID, ok := storage.ParseMenuItemKey(key)
	if !ok {
		return false
	}
	// Never true on an empty uid: a caller with a blank principal must not match a key whose
	// segment failed to parse into anything.
	if restaurantUID == "" || itemUID == "" {
		return false
	}
	return keyRestaurantUID == restaurantUID && keyItemUID == itemUID
}

// discardSupersededImage deletes the object a dish used to show, once the row no longer
// references it.
//
// Best-effort and never fatal, in the same way a realtime publish is: the database write has
// already committed, so there is nothing left to fail. A delete that does not happen costs
// storage until the bucket's lifecycle rule sweeps it, and costs nothing else -- whereas
// turning it into an error would report a failure for an operation that succeeded.
//
// Only keys this platform minted are deleted. An image_url a restaurant pasted from their
// own website is not ours to remove, and IsMenuItemKey is what tells the two apart.
func (s *serviceMenu) discardSupersededImage(ctx context.Context, previousKey, replacementKey string) {
	if previousKey == "" || previousKey == replacementKey || !storage.IsMenuItemKey(previousKey) {
		return
	}
	s.discardUpload(ctx, previousKey)
}

// discardUpload removes one object, logging rather than returning a failure.
//
// Called on two paths that cannot act on an error: cleaning up an upload that was just
// refused, and removing a photograph that has already been replaced in the database.
func (s *serviceMenu) discardUpload(ctx context.Context, key string) {
	if err := s.Access.Storage.Delete(ctx, key); err != nil {
		// Warn, not Error: the object is orphaned, which the bucket lifecycle rule handles,
		// and nothing a reader of this log can do about it is urgent.
		s.Access.Logger.With(ctx).Warnf("[discardUpload] %s left orphaned in the bucket: %+v", key, err)
	}
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
