package types

import "time"

// --- Rating and reviews ---
//
// The design constraint that shapes every DTO here: a diner rates with ONE TAP and is never
// shown a form. That is why the write is a PUT of a single line's rating rather than a POST of
// a whole order's worth -- a batch body would need a Submit button to know when it was complete,
// and a Submit button is the step diners abandon. Each tap is a complete, idempotent request.

// RequestRateOrderItem is one tap on one dish.
//
// Rating is the only required field. Tags and Comment are optional and, on the client, live
// behind a collapsed disclosure -- a diner who never opens it has still submitted a complete
// review.
type RequestRateOrderItem struct {
	// Deliberately carries NO binding tag, unlike most required fields here.
	//
	// `binding:"required,min=1,max=5"` looks right and is wrong twice over. It turns every
	// out-of-range rating into a generic 400 TX_COM_001, so the specific, translatable
	// "a rating must be between 1 and 5" can never be reached -- and on an int, `required`
	// cannot tell a missing field from a deliberate 0, which is exactly the value a buggy
	// client sends. The range is a domain rule with one definition, models.ValidRating, and
	// the service applies it.
	Rating int `json:"rating"`
	// Tags come from a closed vocabulary (models.ReviewTag), validated in the service rather
	// than by a binding tag because the legal set depends on nothing the binder can see.
	// Free text is deliberately not an option here: a fixed vocabulary is what makes this
	// answerable in a tap and countable in aggregate.
	Tags []string `json:"tags,omitempty" binding:"omitempty,max=5,dive,max=32"`
	// Comment is the escape hatch, kept short on purpose. 280 characters is a sentence or
	// two -- enough to name what went wrong, short enough that nobody mistakes this for a
	// review site.
	Comment string `json:"comment,omitempty" binding:"omitempty,max=280"`
}

// OrderItemReviewView is a diner's own rating, echoed back on the line it belongs to.
type OrderItemReviewView struct {
	UID     string   `json:"uid"`
	Rating  int      `json:"rating"`
	Tags    []string `json:"tags,omitempty"`
	Comment string   `json:"comment,omitempty"`
	// UpdatedAt lets the client tell a rating it just wrote from one it loaded, which is what
	// stops an in-flight optimistic update being overwritten by a slower refetch.
	UpdatedAt time.Time `json:"updated_at"`
}

// RatingSummary is a dish's aggregate score.
//
// Average is a float here and nowhere else in the stack -- it is a computed statistic for
// display, never a stored value and never money (DECISIONS.md D7). It is rounded to one
// decimal at the boundary so every client renders the same "4.3" without reimplementing the
// rounding rule.
type RatingSummary struct {
	Average float64 `json:"average"`
	Count   int64   `json:"count"`
}

// --- Service ---
//
// Service is rated ONCE PER SITTING, not once per order: a diner who orders twice has not been
// served by two different restaurants. The write therefore lands on the session, even though the
// request is addressed to an order -- the order in the path is the WARRANT (it is what proves the
// window is open and that this session owns something), not the subject.

// RequestRateService is one tap on the service row.
type RequestRateService struct {
	// No binding tag on Rating, for the reason spelled out on RequestRateOrderItem: `required`
	// cannot distinguish a missing int from a deliberate 0, and a range tag would make the
	// specific, translatable error unreachable.
	Rating int `json:"rating"`
	// Tags come from models.ServiceTag, a different closed vocabulary from the dish one.
	Tags    []string `json:"tags,omitempty" binding:"omitempty,max=5,dive,max=32"`
	Comment string   `json:"comment,omitempty" binding:"omitempty,max=280"`
}

// ServiceReviewView is the diner's own service rating, echoed back.
type ServiceReviewView struct {
	UID       string    `json:"uid"`
	Rating    int       `json:"rating"`
	Tags      []string  `json:"tags,omitempty"`
	Comment   string    `json:"comment,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

// StaffServiceReviewView is one service rating as the admin feed renders it.
//
// A distinct type from ReviewView rather than a shared one with optional fields. ReviewView
// carries item_name, food_type and menu_item_uid, none of which a service rating has; merging them
// would give every row three fields that are always empty in one case, and a client that has to
// know which case it is looking at before it can trust any of them.
type StaffServiceReviewView struct {
	UID     string   `json:"uid"`
	Rating  int      `json:"rating"`
	Tags    []string `json:"tags,omitempty"`
	Comment string   `json:"comment,omitempty"`

	// The order the diner rated from, so staff can find the sitting on the board.
	OrderUID    string `json:"order_uid"`
	OrderNumber string `json:"order_number"`
	TableLabel  string `json:"table_label,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RequestListServiceReviews filters the admin service feed.
type RequestListServiceReviews struct {
	Pagination
	MinRating  int    `form:"min_rating"`
	MaxRating  int    `form:"max_rating"`
	HasComment bool   `form:"has_comment"`
	From       string `form:"from"`
	To         string `form:"to"`
}

// ResponseServiceReviewList is a page of the service feed.
type ResponseServiceReviewList struct {
	Reviews []StaffServiceReviewView `json:"reviews"`
	Meta    PageMeta                 `json:"meta"`
}

// --- Admin reviews ---

// ReviewView is one review as the admin feed renders it.
//
// It carries the dish name and the order number rather than ids, because the feed is read by
// a manager who needs to find the ticket, not by a program that will join.
type ReviewView struct {
	UID    string   `json:"uid"`
	Rating int      `json:"rating"`
	Tags   []string `json:"tags,omitempty"`
	// Comment is empty on most reviews, and the feed is designed for that: the tags and the
	// star are the signal, prose is the exception.
	Comment string `json:"comment,omitempty"`

	// MenuItemUID is what the "see every review of this dish" filter is keyed on.
	MenuItemUID string `json:"menu_item_uid"`
	// ItemName is the name SNAPSHOTTED on the order line, not the dish's current name
	// (DECISIONS.md D8). A dish renamed since is still shown as the diner saw it, or the
	// review would appear to be about something they never ordered.
	ItemName string `json:"item_name"`
	FoodType string `json:"food_type"`

	OrderUID    string `json:"order_uid"`
	OrderNumber string `json:"order_number"`
	TableLabel  string `json:"table_label,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RequestListReviews filters the admin reviews feed.
type RequestListReviews struct {
	Pagination
	// MenuItemUID drills into one dish, which is how a manager arrives here from the menu
	// manager's rating column.
	MenuItemUID string `form:"menu_item_uid"`
	// MaxRating is the "show me the complaints" filter -- the reason a manager opens this
	// screen mid-service. Expressed as a ceiling rather than an exact value because "3 and
	// below" is the actual question; nobody wants to look at exactly-2-star reviews.
	MaxRating int `form:"max_rating"`
	MinRating int `form:"min_rating"`
	// HasComment narrows to the reviews someone wrote prose on.
	HasComment bool `form:"has_comment"`
	// From and To are inclusive date bounds, YYYY-MM-DD, matching the stats endpoints.
	From string `form:"from"`
	To   string `form:"to"`
}

// ResponseReviewList is a page of the feed.
type ResponseReviewList struct {
	Reviews []ReviewView `json:"reviews"`
	Meta    PageMeta     `json:"meta"`
}

// RatedDishView is one dish in the best/worst tables on the reviews dashboard.
type RatedDishView struct {
	MenuItemUID string        `json:"menu_item_uid"`
	Name        string        `json:"name"`
	FoodType    string        `json:"food_type"`
	Rating      RatingSummary `json:"rating"`
}

// ResponseReviewSummary is the reviews dashboard.
//
// TWO headline numbers, never one. Food and service are rated separately and reported separately,
// because a single blended average points at nobody: "you are a 3.8" is not something a manager can
// act on, where "food 4.6, service 3.2" names a team and a shift (DECISIONS.md D17).
type ResponseReviewSummary struct {
	// Food covers every DISH rating this restaurant has received.
	Food RatingSummary `json:"food"`
	// Service covers every SERVICE rating. Zero-count until diners start leaving them, which is
	// its own signal rather than a gap.
	Service RatingSummary `json:"service"`
	// Distribution is the count at each star for FOOD, indexed 0..4 for 1..5 stars.
	//
	// Sent as well as the average because the two answer different questions: a 3.0 built
	// from straight 3s is a dull menu, and a 3.0 built from 5s and 1s is an inconsistent
	// kitchen. Those need opposite responses, and an average alone cannot tell them apart.
	Distribution [5]int64 `json:"distribution"`
	// ServiceDistribution is the same shape for service, and answers the sharper version of the
	// same question: intermittently bad service (5s and 1s) is a staffing or shift problem, where
	// uniformly mediocre service is a training one.
	ServiceDistribution [5]int64 `json:"service_distribution"`
	// NeedsAttention is the lowest-rated dishes, worst first -- the working list. Restricted
	// to dishes with enough reviews to mean something.
	NeedsAttention []RatedDishView `json:"needs_attention"`
	// TopRated is the other end, best first.
	TopRated []RatedDishView `json:"top_rated"`
	// MinReviewsForRanking is the threshold the two lists were built with, sent so the panel
	// can explain an empty list rather than looking broken on a restaurant's first night.
	MinReviewsForRanking int `json:"min_reviews_for_ranking"`
}
