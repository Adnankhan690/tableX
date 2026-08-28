package types

import "time"

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
	// Rating is the dish's aggregate score, omitted entirely rather than sent as zero when
	// there is nothing to report.
	//
	// On the DINER menu it is withheld until the dish has MinRatingsToPublish reviews. A
	// "5.0" backed by one rating is not information, it is noise that makes a new dish look
	// better than a consistently good one -- and the first diner to leave a 2 would visibly
	// halve it. The admin menu has no such threshold: staff are owed the raw count.
	Rating *RatingSummary `json:"rating,omitempty"`
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
	// ImageUploadEnabled reports whether this DEPLOYMENT has an object store configured
	// (DECISIONS.md D15). It rides on the menu response because that is the one screen that
	// needs it, and it is a deployment fact rather than a restaurant one -- so it does not
	// belong on RestaurantSettings, which is per-tenant.
	//
	// The admin panel hides the upload control when this is false, which is what stops a
	// manager meeting TX_IMG_001 by pressing a button that was never going to work.
	ImageUploadEnabled bool `json:"image_upload_enabled"`
	// ImageMaxUploadBytes is this deployment's per-photo ceiling, sent so the admin panel can
	// downscale to a size that will actually be accepted.
	//
	// Without it the client can only guess at the default, and a deployment that lowered the
	// limit produces a dead end: a 3MB photo is small enough that the client leaves it alone,
	// the server refuses it, and retrying takes the identical branch and fails identically.
	// Zero when uploads are disabled.
	ImageMaxUploadBytes int64 `json:"image_max_upload_bytes"`
}

// --- Dish photographs (DECISIONS.md D15) ---
//
// Uploading is two calls, not one, and the split is the whole safety design.
//
// The first mints a presigned URL and the browser PUTs the bytes straight to R2, so a 5 MB
// photograph never passes through this API. The second attaches the finished object to the
// dish, and is the point at which the server checks what actually landed in the bucket --
// its size, and its real content type sniffed from the leading bytes. A single call could
// not do that, because at the moment a URL is issued there is nothing to inspect.

// RequestCreateImageUpload asks for somewhere to put one photograph.
//
// Both fields describe what the client INTENDS to upload. They are signed into the URL, so
// R2 rejects a body that disagrees -- but they are a claim, not a fact, which is why the
// confirm step re-checks rather than trusting them.
type RequestCreateImageUpload struct {
	ContentType string `json:"content_type" binding:"required"`
	SizeBytes   int64  `json:"size_bytes" binding:"required,min=1"`
}

// ResponseImageUpload is a time-boxed capability to write exactly one object.
type ResponseImageUpload struct {
	UploadURL string `json:"upload_url"`
	Method    string `json:"method"`
	// Headers must be sent with the PUT verbatim. They are inside the signature, so adding,
	// dropping or renaming one produces a 403 rather than a partial upload.
	//
	// Host and Content-Length are deliberately absent: browsers forbid script from setting
	// either and supply both themselves.
	Headers map[string]string `json:"headers"`
	// ObjectKey is handed back to the confirm call. It encodes the restaurant and the menu
	// item, and confirm refuses a key naming any other.
	ObjectKey string    `json:"object_key"`
	ExpiresAt time.Time `json:"expires_at"`
	// MaxBytes is echoed so the client can fail a too-large file locally, before spending a
	// restaurant's uplink on an upload the confirm step would reject.
	MaxBytes int64 `json:"max_bytes"`
}

// RequestConfirmImageUpload attaches a finished upload to the dish.
type RequestConfirmImageUpload struct {
	ObjectKey string `json:"object_key" binding:"required"`
}
