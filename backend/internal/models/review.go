package models

import (
	"database/sql/driver"
	"fmt"
	"strings"
	"time"
)

// Rating bounds. Five points, because the whole interaction is one tap on a row of stars
// and a row wider than five does not fit a phone held one-handed (PRD 7).
const (
	RatingMin = 1
	RatingMax = 5
)

// ReviewTag is a one-tap reason attached to a rating, drawn from a closed vocabulary.
//
// A closed vocabulary rather than free text is the entire reason this feature is fast
// enough to get answered. Typing on a phone in a restaurant is the step diners abandon;
// tapping "Too spicy" is not. It is also the only form of this data a kitchen can act on
// in aggregate -- "9 people said cold this week" is a service problem with an address,
// where nine sentences of prose are an afternoon of reading.
type ReviewTag string

// The vocabulary. Split by polarity because the client offers the negative set for a low
// rating and the positive set for a high one: showing "Tasty" to someone who just tapped
// one star reads as not listening.
const (
	// Positive, offered at 4-5 stars.
	ReviewTagTasty         ReviewTag = "tasty"
	ReviewTagFresh         ReviewTag = "fresh"
	ReviewTagGoodPortion   ReviewTag = "good_portion"
	ReviewTagWellPresented ReviewTag = "well_presented"
	ReviewTagWorthTheWait  ReviewTag = "worth_the_wait"

	// Negative, offered at 1-3 stars.
	ReviewTagBland          ReviewTag = "bland"
	ReviewTagTooSpicy       ReviewTag = "too_spicy"
	ReviewTagServedCold     ReviewTag = "served_cold"
	ReviewTagSmallPortion   ReviewTag = "small_portion"
	ReviewTagNotAsDescribed ReviewTag = "not_as_described"
)

// "slow_to_arrive" used to live in the list above and was deliberately removed when service
// ratings arrived (DECISIONS.md D17). It is a floor complaint, and offering it in a food context
// was the only outlet a diner had for one -- so it collected them, against a dish.
//
// Removing the tag is NOT the fix, and it is worth being precise about that: what actually
// dragged a dish's average down was the diner giving it two STARS because the food was late. The
// fix is that there is now somewhere else to say it. Dropping the tag just stops inviting the
// complaint in the wrong place.
//
// Rows written before this still hold the string. Nothing re-validates on read -- ReviewTags.Scan
// splits, it does not check -- so historical reviews are unaffected, and a diner who edits one
// drops it on the way through the client's polarity filter.

// reviewTagVocabulary is the authoritative set. A tag outside it is rejected rather than
// stored: the value of this column is that it can be counted, and one typo'd variant is a
// bucket nobody will ever look in.
var reviewTagVocabulary = map[ReviewTag]bool{
	ReviewTagTasty: true, ReviewTagFresh: true, ReviewTagGoodPortion: true,
	ReviewTagWellPresented: true, ReviewTagWorthTheWait: true,
	ReviewTagBland: true, ReviewTagTooSpicy: true, ReviewTagServedCold: true,
	ReviewTagSmallPortion: true, ReviewTagNotAsDescribed: true,
}

// Valid reports whether the tag is one this application recognises.
func (t ReviewTag) Valid() bool { return reviewTagVocabulary[t] }

// MaxReviewTags bounds how many reasons ride on one rating. Five is more than the client
// ever offers for a single polarity; the limit exists so a hand-rolled request cannot pad
// the column.
const MaxReviewTags = 5

// ReviewTags is the tag list as it is stored: comma-separated in a single TEXT column.
//
// A custom type rather than a Postgres array so the same column round-trips under SQLite,
// which is what the unit tests run against. It follows the precedent JSONMap sets in
// payment.go -- one type implementing Valuer and Scanner, so no caller has to know the
// storage shape.
type ReviewTags []string

// Value implements driver.Valuer. An empty list stores "" rather than NULL, matching the
// column's NOT NULL DEFAULT ” so a row written by GORM and one written by the migration's
// default read back identically.
func (t ReviewTags) Value() (driver.Value, error) {
	return strings.Join(t, ","), nil
}

// Scan implements sql.Scanner for both []byte (Postgres) and string (SQLite) payloads.
func (t *ReviewTags) Scan(src any) error {
	if src == nil {
		*t = nil
		return nil
	}

	var raw string
	switch v := src.(type) {
	case []byte:
		raw = string(v)
	case string:
		raw = v
	default:
		return fmt.Errorf("models: cannot scan %T into ReviewTags", src)
	}

	if raw == "" {
		*t = nil
		return nil
	}
	*t = strings.Split(raw, ",")
	return nil
}

// OrderItemReview is one diner's rating of one dish on one order (PRD 6.5).
//
// Identity is the ORDER LINE, not the menu item: the same dish ordered on two nights is
// two ratings, because it was two platings. Collapsing them would let a dish that has got
// worse hide behind the night it was good.
type OrderItemReview struct {
	ID           int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID          string `gorm:"size:64;not null;unique" json:"uid"`
	RestaurantID int32  `gorm:"not null;index" json:"restaurant_id"`
	OrderID      int32  `gorm:"not null;index" json:"order_id"`
	// OrderItemID is unique. A diner correcting a mis-tapped star updates this row rather
	// than inserting a second one, which is what keeps the menu_item counters reconcilable.
	OrderItemID int32 `gorm:"not null;uniqueIndex" json:"order_item_id"`
	// MenuItemID is what the aggregate is grouped by. Snapshotted like the rest of the line
	// (DECISIONS.md D8) in the sense that it records which dish was ordered, never which
	// dish is on the menu now.
	MenuItemID int32 `gorm:"not null;index" json:"menu_item_id"`
	// GuestSessionID is nullable so pruning anonymous sessions cannot take a night's
	// ratings with it.
	GuestSessionID *int32 `json:"guest_session_id,omitempty"`

	Rating  int        `gorm:"not null" json:"rating"`
	Tags    ReviewTags `gorm:"type:text;not null;default:''" json:"tags,omitempty"`
	Comment string     `gorm:"type:text;not null;default:''" json:"comment,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	OrderItem *OrderItem `gorm:"foreignKey:OrderItemID" json:"order_item,omitempty"`
	Order     *Order     `gorm:"foreignKey:OrderID" json:"order,omitempty"`
	MenuItem  *MenuItem  `gorm:"foreignKey:MenuItemID" json:"menu_item,omitempty"`
}

func (OrderItemReview) TableName() string { return TableNameOrderItemReview }

// ValidRating reports whether a rating is inside the scale. Mirrors the CHECK constraint
// on order_item_review.rating.
func ValidRating(rating int) bool { return rating >= RatingMin && rating <= RatingMax }

// --- Service ---

// ServiceTag is a one-tap reason attached to a SERVICE rating.
//
// A separate type from ReviewTag rather than one vocabulary with a polarity split, because the two
// are validated against different sets and attached to different tables. Sharing a type would make
// "tasty" a legal value on a service review and "slow_service" a legal value on a dish -- and the
// only thing keeping them apart would be a convention nobody can see at the call site.
type ServiceTag string

// The vocabulary. Split by polarity for the same reason the dish tags are: the client offers the
// negative set at a low rating and the positive set at a high one.
const (
	// Positive, offered at 4-5 stars.
	ServiceTagQuick      ServiceTag = "quick_service"
	ServiceTagFriendly   ServiceTag = "friendly_staff"
	ServiceTagAttentive  ServiceTag = "attentive"
	ServiceTagCleanTable ServiceTag = "clean_table"

	// Negative, offered at 1-3 stars.
	ServiceTagSlow            ServiceTag = "slow_service"
	ServiceTagStaffHardToFind ServiceTag = "hard_to_find_staff"
	ServiceTagTableNotClean   ServiceTag = "table_not_clean"
	ServiceTagOrderWrong      ServiceTag = "order_wrong"
	ServiceTagRushed          ServiceTag = "rushed"
)

// serviceTagVocabulary is the authoritative set, for the same reason as the dish one: a tag is
// only worth storing if it can be counted, and one typo'd variant is a bucket nobody looks in.
var serviceTagVocabulary = map[ServiceTag]bool{
	ServiceTagQuick: true, ServiceTagFriendly: true, ServiceTagAttentive: true,
	ServiceTagCleanTable: true,
	ServiceTagSlow:       true, ServiceTagStaffHardToFind: true, ServiceTagTableNotClean: true,
	ServiceTagOrderWrong: true, ServiceTagRushed: true,
}

// Valid reports whether the tag is one this application recognises.
func (t ServiceTag) Valid() bool { return serviceTagVocabulary[t] }

// ServiceReview is one diner's rating of the service during their sitting (DECISIONS.md D17).
//
// Kept apart from OrderItemReview because it answers a different question. Blending the two would
// give a restaurant one number that points at nobody: "food 4.6, service 3.2" names a team and a
// shift, where a single 3.8 names neither.
type ServiceReview struct {
	ID           int32  `gorm:"primaryKey;autoIncrement" json:"id"`
	UID          string `gorm:"size:64;not null;unique" json:"uid"`
	RestaurantID int32  `gorm:"not null;index" json:"restaurant_id"`
	// GuestSessionID is the identity AND the uniqueness key: service is experienced once per
	// sitting, not once per order. Nullable so reaping expired sessions cannot delete a night's
	// feedback -- see the migration, where that choice is load-bearing.
	GuestSessionID *int32 `gorm:"uniqueIndex" json:"guest_session_id,omitempty"`
	// OrderID is the order the diner was looking at when they rated. Context rather than identity:
	// it is what lets staff find the sitting on the board.
	OrderID int32 `gorm:"not null;index" json:"order_id"`

	Rating  int         `gorm:"not null" json:"rating"`
	Tags    ServiceTags `gorm:"type:text;not null;default:''" json:"tags,omitempty"`
	Comment string      `gorm:"type:text;not null;default:''" json:"comment,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	Order *Order `gorm:"foreignKey:OrderID" json:"order,omitempty"`
}

func (ServiceReview) TableName() string { return TableNameServiceReview }

// ServiceTags is the service tag list as stored: comma-separated in one TEXT column.
//
// A distinct type from ReviewTags rather than a reuse, so the two columns cannot be assigned to
// each other by mistake. The storage shape and the SQLite reasoning are identical -- see
// ReviewTags above for why it is not a Postgres array.
type ServiceTags []string

// Value implements driver.Valuer. An empty list stores "" rather than NULL, matching the column's
// NOT NULL DEFAULT ”.
func (t ServiceTags) Value() (driver.Value, error) {
	return strings.Join(t, ","), nil
}

// Scan implements sql.Scanner for both []byte (Postgres) and string (SQLite) payloads.
func (t *ServiceTags) Scan(src any) error {
	if src == nil {
		*t = nil
		return nil
	}

	var raw string
	switch v := src.(type) {
	case []byte:
		raw = string(v)
	case string:
		raw = v
	default:
		return fmt.Errorf("models: cannot scan %T into ServiceTags", src)
	}

	if raw == "" {
		*t = nil
		return nil
	}
	*t = strings.Split(raw, ",")
	return nil
}
