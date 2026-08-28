package services

import (
	"context"
	"errors"
	"testing"

	"tablex/internal/models"
	"tablex/internal/storage"
	"tablex/internal/utils"
)

// The authorisation decision on the image-confirm path, exhaustively.
//
// It is pure and takes no database handle, so the whole matrix is enumerated here rather
// than reached through a fixture -- the same reasoning as order_state_test.go. What it
// guards is a data-isolation boundary: the object key comes from the client, and the only
// thing standing between "well-formed key" and "this restaurant's dish now shows another
// restaurant's photograph" is this comparison.

// newKey mints a real key the way the service does, so these tests exercise the actual
// format rather than a hand-written approximation of it that could drift.
func newKey(t *testing.T, restaurantUID, itemUID string) string {
	t.Helper()
	key, err := storage.MenuItemKey(restaurantUID, itemUID, "image/jpeg")
	if err != nil {
		t.Fatalf("MenuItemKey: %v", err)
	}
	return key
}

func TestImageKeyBelongsTo_AcceptsAKeyMintedForThisDish(t *testing.T) {
	restaurant := utils.GenerateUID(utils.UIDPrefixRestaurant)
	item := utils.GenerateUID(utils.UIDPrefixMenuItem)

	if !imageKeyBelongsTo(newKey(t, restaurant, item), restaurant, item) {
		t.Fatal("a key this service just minted for this dish was refused")
	}
}

// The case the check exists for: restaurant A confirming a key that names restaurant B.
// Both keys are perfectly well-formed, so nothing but the uid comparison catches it.
func TestImageKeyBelongsTo_RefusesAnotherRestaurantsKey(t *testing.T) {
	mine := utils.GenerateUID(utils.UIDPrefixRestaurant)
	theirs := utils.GenerateUID(utils.UIDPrefixRestaurant)
	item := utils.GenerateUID(utils.UIDPrefixMenuItem)

	foreign := newKey(t, theirs, item)
	if !storage.IsMenuItemKey(foreign) {
		t.Fatal("test setup is broken: the foreign key is not well-formed, so this would pass for the wrong reason")
	}

	if imageKeyBelongsTo(foreign, mine, item) {
		t.Fatal("a key belonging to another restaurant was accepted -- this is a tenant-isolation break")
	}
}

// The quieter sibling: the right restaurant, the wrong dish. Not a tenant break, but it
// would attach a photograph to an item the manager was not editing.
func TestImageKeyBelongsTo_RefusesAnotherDishOfTheSameRestaurant(t *testing.T) {
	restaurant := utils.GenerateUID(utils.UIDPrefixRestaurant)
	editing := utils.GenerateUID(utils.UIDPrefixMenuItem)
	other := utils.GenerateUID(utils.UIDPrefixMenuItem)

	if imageKeyBelongsTo(newKey(t, restaurant, other), restaurant, editing) {
		t.Fatal("a key for a different dish was accepted")
	}
}

func TestImageKeyBelongsTo_RefusesMalformedKeys(t *testing.T) {
	restaurant := utils.GenerateUID(utils.UIDPrefixRestaurant)
	item := utils.GenerateUID(utils.UIDPrefixMenuItem)
	valid := newKey(t, restaurant, item)

	cases := map[string]string{
		"empty":                "",
		"traversal":            "menu/" + restaurant + "/../" + item + "/img_aaaaaaaaaaaa.jpg",
		"absolute":             "/" + valid,
		"query suffix":         valid + "?x=1",
		"disallowed extension": "menu/" + restaurant + "/" + item + "/img_aaaaaaaaaaaa.svg",
		"double extension":     "menu/" + restaurant + "/" + item + "/img_aaaaaaaaaaaa.jpg.html",
		"uids swapped":         "menu/" + item + "/" + restaurant + "/img_aaaaaaaaaaaa.jpg",
		"bare uid":             item,
		"wrong prefix":         "logos/" + restaurant + "/" + item + "/img_aaaaaaaaaaaa.jpg",
	}

	for name, key := range cases {
		if imageKeyBelongsTo(key, restaurant, item) {
			t.Errorf("%s: accepted %q", name, key)
		}
	}
}

// A principal with no restaurant must never match anything. Without the explicit guard, a
// blank uid compared against a key segment that also failed to parse would be a way in.
func TestImageKeyBelongsTo_RefusesEmptyPrincipal(t *testing.T) {
	restaurant := utils.GenerateUID(utils.UIDPrefixRestaurant)
	item := utils.GenerateUID(utils.UIDPrefixMenuItem)
	key := newKey(t, restaurant, item)

	if imageKeyBelongsTo(key, "", item) {
		t.Error("an empty restaurant uid was accepted")
	}
	if imageKeyBelongsTo(key, restaurant, "") {
		t.Error("an empty item uid was accepted")
	}
	if imageKeyBelongsTo(key, "", "") {
		t.Error("an entirely empty principal was accepted")
	}
}

// menuItemImageURL is the other half of the mapping: two columns, one field on the wire.
// Its precedence rules decide what a diner actually sees, so they are pinned here.

func TestMenuItemImageURL_PrefersTheHostedObject(t *testing.T) {
	store := stubStore{base: "https://img.example.com"}

	item := menuItemWith("menu/rst_aaaaaaaaaaaa/itm_bbbbbbbbbbbb/img_cccccccccccc.jpg", "https://elsewhere.example/old.jpg")
	got := menuItemImageURL(item, store)

	want := "https://img.example.com/menu/rst_aaaaaaaaaaaa/itm_bbbbbbbbbbbb/img_cccccccccccc.jpg"
	if got != want {
		t.Fatalf("got %q, want the hosted object %q", got, want)
	}
}

func TestMenuItemImageURL_FallsBackToAPastedURL(t *testing.T) {
	store := stubStore{base: "https://img.example.com"}

	// Every restaurant onboarded before uploads existed is in this state and must keep
	// rendering untouched.
	got := menuItemImageURL(menuItemWith("", "https://restaurant.example/dish.jpg"), store)
	if got != "https://restaurant.example/dish.jpg" {
		t.Fatalf("got %q, want the pasted URL unchanged", got)
	}
}

func TestMenuItemImageURL_IsEmptyWhenThereIsNoImage(t *testing.T) {
	if got := menuItemImageURL(menuItemWith("", ""), stubStore{base: "https://img.example.com"}); got != "" {
		t.Fatalf("got %q, want an empty string", got)
	}
}

// Losing the storage configuration must degrade to "no photo", not to "broken image on
// every dish". The row keeps its key, so restoring the configuration restores the photo.
func TestMenuItemImageURL_YieldsNothingWhenStorageIsUnconfigured(t *testing.T) {
	item := menuItemWith("menu/rst_aaaaaaaaaaaa/itm_bbbbbbbbbbbb/img_cccccccccccc.jpg", "")

	if got := menuItemImageURL(item, storage.NewUnconfigured()); got != "" {
		t.Fatalf("got %q, want an empty string rather than a URL that cannot resolve", got)
	}
}

// --- Test doubles ---

// stubStore is the smallest thing satisfying storage.Storage. Only PublicURL is exercised
// by the tests above; the rest exist so the interface is satisfied, and they fail loudly
// rather than returning a zero value, so a test that starts calling one is a test that
// noticed.
type stubStore struct{ base string }

func (s stubStore) Configured() bool { return true }

func (s stubStore) PublicURL(key string) string {
	if key == "" {
		return ""
	}
	return s.base + "/" + key
}

func (stubStore) PresignPut(context.Context, string, string, int64) (*storage.PresignedUpload, error) {
	return nil, errors.New("stubStore: PresignPut is not exercised by these tests")
}

func (stubStore) Head(context.Context, string) (*storage.ObjectInfo, error) {
	return nil, errors.New("stubStore: Head is not exercised by these tests")
}

func (stubStore) Peek(context.Context, string, int64) ([]byte, error) {
	return nil, errors.New("stubStore: Peek is not exercised by these tests")
}

func (stubStore) Delete(context.Context, string) error {
	return errors.New("stubStore: Delete is not exercised by these tests")
}

func menuItemWith(imageKey, imageURL string) *models.MenuItem {
	return &models.MenuItem{ImageKey: imageKey, ImageURL: imageURL}
}
