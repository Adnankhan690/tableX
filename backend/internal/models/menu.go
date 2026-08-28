package models

import "time"

// MenuCategory groups items into the tabs shown on the diner menu (PRD 6.2).
type MenuCategory struct {
	ID           int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID          string `gorm:"size:64;not null;unique" json:"uid"`
	RestaurantID int32  `gorm:"not null;index" json:"restaurant_id"`
	Name         string `gorm:"size:64;not null" json:"name"`
	Description  string `gorm:"type:text" json:"description,omitempty"`
	// SortOrder is restaurant-controlled: a menu runs Starters before Desserts, which is
	// neither alphabetical nor insertion order.
	SortOrder int          `gorm:"not null;default:0" json:"sort_order"`
	Status    EntityStatus `gorm:"size:32;not null;default:'active'" json:"status"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`

	Items []MenuItem `gorm:"foreignKey:CategoryID" json:"items,omitempty"`
}

func (MenuCategory) TableName() string { return TableNameMenuCategory }

// MenuItem is a single orderable dish.
type MenuItem struct {
	ID           int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID          string `gorm:"size:64;not null;unique" json:"uid"`
	RestaurantID int32  `gorm:"not null;index" json:"restaurant_id"`
	CategoryID   int32  `gorm:"not null;index" json:"category_id"`
	Name         string `gorm:"size:128;not null" json:"name"`
	Description  string `gorm:"type:text" json:"description,omitempty"`
	// ImageURL is a URL the restaurant pasted from a site they already run, served
	// verbatim. ImageKey is an object we host ourselves, whose URL is resolved against
	// storage.public_base_url at read time (DECISIONS.md D15).
	//
	// At most one is ever set. ImageKey wins when both are, because that is the state a
	// half-finished migration off an external host leaves behind, and the hosted copy is
	// the one we can guarantee still resolves.
	ImageURL string `gorm:"type:text" json:"image_url,omitempty"`
	ImageKey string `gorm:"type:text" json:"image_key,omitempty"`
	// PriceMinor is paise (DECISIONS.md D7).
	PriceMinor int64      `gorm:"not null" json:"price_minor"`
	FoodType   FoodType   `gorm:"size:16;not null" json:"food_type"`
	SpiceLevel SpiceLevel `gorm:"size:16" json:"spice_level,omitempty"`
	// IsAvailable is the "we ran out" toggle staff flip during service; Status is the
	// lifecycle flag. Keeping them apart means a sold-out evening does not archive the
	// dish and orphan its order history.
	IsAvailable  bool `gorm:"not null;default:true" json:"is_available"`
	IsBestseller bool `gorm:"not null;default:false" json:"is_bestseller"`
	PrepTimeMins *int `json:"prep_time_mins,omitempty"`
	SortOrder    int  `gorm:"not null;default:0" json:"sort_order"`

	// RatingCount and RatingSum are the running review aggregate, maintained by delta
	// inside the review transaction rather than recomputed on read. The diner menu is the
	// hot path in this product (PRD 7) and must not carry a GROUP BY that grows with every
	// review ever left. Sum and count rather than a stored average: an average is lossy and
	// cannot be updated without a read-modify-write, which loses one of two concurrent
	// reviews. See migration 016 for the full argument and the reconstruction query.
	RatingCount int   `gorm:"not null;default:0" json:"rating_count"`
	RatingSum   int64 `gorm:"not null;default:0" json:"rating_sum"`

	Status    EntityStatus `gorm:"size:32;not null;default:'active'" json:"status"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`

	Category *MenuCategory `gorm:"foreignKey:CategoryID" json:"category,omitempty"`
}

// AverageRating returns the mean rating, and false when the dish has none.
//
// The boolean is the point: zero is not a rating, and a caller that treats an unrated dish
// as 0.0 sorts every new dish below the worst-reviewed one on the menu.
func (m *MenuItem) AverageRating() (float64, bool) {
	if m.RatingCount <= 0 {
		return 0, false
	}
	return float64(m.RatingSum) / float64(m.RatingCount), true
}

func (MenuItem) TableName() string { return TableNameMenuItem }

// Orderable reports whether a diner may add this item to a cart right now.
func (m *MenuItem) Orderable() bool {
	return m.Status == EntityStatusActive && m.IsAvailable
}
