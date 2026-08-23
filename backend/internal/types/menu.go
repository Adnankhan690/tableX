package types

// MenuItemView is one dish as the diner menu renders it.
type MenuItemView struct {
	UID         string `json:"uid"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	ImageURL    string `json:"image_url,omitempty"`
	Price       Money  `json:"price"`
	FoodType    string `json:"food_type"`
	SpiceLevel  string `json:"spice_level,omitempty"`
	// IsAvailable is sent rather than the item being filtered out, so the menu can grey it
	// out in place. A dish that silently vanishes reads as a broken page; one marked
	// "unavailable" reads as a restaurant that ran out.
	IsAvailable  bool   `json:"is_available"`
	IsBestseller bool   `json:"is_bestseller"`
	PrepTimeMins *int   `json:"prep_time_mins,omitempty"`
	CategoryUID  string `json:"category_uid"`
}

// MenuCategoryView is one category with its items nested.
type MenuCategoryView struct {
	UID         string         `json:"uid"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Items       []MenuItemView `json:"items"`
}

// ResponseMenu is the diner menu: the whole thing, in one response.
//
// One request rather than a category list plus N item requests. On a 3G connection each
// round trip costs more than the bytes do, and PRD 7 makes menu load time a product
// requirement.
type ResponseMenu struct {
	Restaurant RestaurantSummary  `json:"restaurant"`
	Categories []MenuCategoryView `json:"categories"`
	// TaxBps and ServiceChargeBps let the cart show the diner an accurate total before
	// they commit, without a server round trip per quantity tap. The server still
	// recomputes authoritatively at placement -- this is for display only.
	TaxBps           int `json:"tax_bps"`
	ServiceChargeBps int `json:"service_charge_bps"`
}

// RequestCreateCategory adds a menu category.
type RequestCreateCategory struct {
	Name        string `json:"name" binding:"required,min=1,max=64"`
	Description string `json:"description,omitempty"`
	SortOrder   int    `json:"sort_order"`
}

// RequestUpdateCategory patches a menu category.
type RequestUpdateCategory struct {
	Name        *string `json:"name,omitempty" binding:"omitempty,min=1,max=64"`
	Description *string `json:"description,omitempty"`
	SortOrder   *int    `json:"sort_order,omitempty"`
	Status      *string `json:"status,omitempty" binding:"omitempty,oneof=active inactive archived"`
}

// RequestCreateMenuItem adds a dish.
type RequestCreateMenuItem struct {
	CategoryUID string `json:"category_uid" binding:"required"`
	Name        string `json:"name" binding:"required,min=1,max=128"`
	Description string `json:"description,omitempty"`
	ImageURL    string `json:"image_url,omitempty"`
	// PriceMinor is paise, taken as an integer so no float ever reaches the server
	// (DECISIONS.md D7).
	PriceMinor int64 `json:"price_minor" binding:"min=0"`
	// FoodType is required. An unlabelled dish is unorderable for a large share of diners
	// in this market, so it is a validation error rather than a default.
	FoodType     string `json:"food_type" binding:"required,oneof=veg non_veg egg"`
	SpiceLevel   string `json:"spice_level,omitempty" binding:"omitempty,oneof=mild medium hot"`
	IsAvailable  *bool  `json:"is_available,omitempty"`
	IsBestseller *bool  `json:"is_bestseller,omitempty"`
	PrepTimeMins *int   `json:"prep_time_mins,omitempty" binding:"omitempty,min=0,max=240"`
	SortOrder    int    `json:"sort_order"`
}

// RequestUpdateMenuItem patches a dish.
type RequestUpdateMenuItem struct {
	CategoryUID  *string `json:"category_uid,omitempty"`
	Name         *string `json:"name,omitempty" binding:"omitempty,min=1,max=128"`
	Description  *string `json:"description,omitempty"`
	ImageURL     *string `json:"image_url,omitempty"`
	PriceMinor   *int64  `json:"price_minor,omitempty" binding:"omitempty,min=0"`
	FoodType     *string `json:"food_type,omitempty" binding:"omitempty,oneof=veg non_veg egg"`
	SpiceLevel   *string `json:"spice_level,omitempty" binding:"omitempty,oneof=mild medium hot"`
	IsAvailable  *bool   `json:"is_available,omitempty"`
	IsBestseller *bool   `json:"is_bestseller,omitempty"`
	PrepTimeMins *int    `json:"prep_time_mins,omitempty" binding:"omitempty,min=0,max=240"`
	SortOrder    *int    `json:"sort_order,omitempty"`
	Status       *string `json:"status,omitempty" binding:"omitempty,oneof=active inactive archived"`
}

// RequestSetAvailability is the fast path staff use mid-service: one tap, one field.
// Separate from the full update so marking a dish sold out cannot accidentally submit a
// stale price from a form the manager left open.
type RequestSetAvailability struct {
	IsAvailable bool `json:"is_available"`
}

// AdminMenuItemView is a dish as the admin panel sees it, including the fields a diner
// never needs.
type AdminMenuItemView struct {
	MenuItemView
	Status    string `json:"status"`
	SortOrder int    `json:"sort_order"`
}

// AdminMenuCategoryView is a category as the admin panel sees it.
type AdminMenuCategoryView struct {
	UID         string              `json:"uid"`
	Name        string              `json:"name"`
	Description string              `json:"description,omitempty"`
	SortOrder   int                 `json:"sort_order"`
	Status      string              `json:"status"`
	Items       []AdminMenuItemView `json:"items"`
}

// ResponseAdminMenu is the full menu for management, including archived rows.
type ResponseAdminMenu struct {
	Categories []AdminMenuCategoryView `json:"categories"`
}
