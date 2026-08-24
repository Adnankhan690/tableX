package services

import (
	"strings"
	"testing"

	"tablex/internal/response"
	"tablex/internal/types"
)

// The pure decisions inside onboarding, tested without a database.
//
// These are the parts that decide what actually gets written: the slug that becomes a
// restaurant's permanent public URL, the timezone that decides when its daily order numbers
// roll over, and the defaults that apply when a field is omitted. Each has a wrong answer that
// a database test would not catch -- an omitted tax field silently meaning 0% is a correct
// insert of the wrong number.

func TestResolveRestaurantSlug_DerivesFromNameWhenAbsent(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"Spice Garden", "spice-garden"},
		{"  Coastal Curry  ", "coastal-curry"},
		{"Tandoor Junction!", "tandoor-junction"},
		{"Cafe 24/7", "cafe-24-7"},
		{"THE BIG PLATE", "the-big-plate"},
		// Runs of punctuation collapse to one separator rather than a row of dashes, and
		// leading and trailing separators are dropped -- "-spice-garden-" would be an ugly
		// permanent URL for a restaurant that did nothing wrong.
		{"Spice   &&&   Garden", "spice-garden"},
		{"...Dhaba...", "dhaba"},
	}

	for _, c := range cases {
		got, appErr := resolveRestaurantSlug(c.name, "")
		if appErr != nil {
			t.Errorf("resolveRestaurantSlug(%q, \"\"): unexpected error %v", c.name, appErr)
			continue
		}
		if got != c.want {
			t.Errorf("resolveRestaurantSlug(%q, \"\") = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestResolveRestaurantSlug_NormalisesASuppliedSlug(t *testing.T) {
	// A supplied slug is fixed rather than refused. The operator's intent is obvious, and
	// rejecting "Spice Garden" when the answer is "spice-garden" is a worse experience than
	// normalising it -- but it does mean two spellings of the same intent must land on the same
	// value, or a retry after a 409 would create a second restaurant instead of colliding.
	for _, supplied := range []string{"Spice Garden", "spice_garden", "  spice-garden  ", "Spice--Garden"} {
		got, appErr := resolveRestaurantSlug("Anything Else", supplied)
		if appErr != nil {
			t.Errorf("resolveRestaurantSlug(_, %q): unexpected error %v", supplied, appErr)
			continue
		}
		if got != "spice-garden" {
			t.Errorf("resolveRestaurantSlug(_, %q) = %q, want %q", supplied, got, "spice-garden")
		}
	}
}

func TestResolveRestaurantSlug_SuppliedWins(t *testing.T) {
	// The whole point of the field: the derived form is taken or ugly, so the operator picks.
	got, appErr := resolveRestaurantSlug("Spice Garden", "spice-garden-2")
	if appErr != nil {
		t.Fatalf("unexpected error: %v", appErr)
	}
	if got != "spice-garden-2" {
		t.Fatalf("supplied slug ignored: got %q", got)
	}
}

func TestResolveRestaurantSlug_RefusesWhatNormalisesToNothing(t *testing.T) {
	// A name of pure punctuation cannot produce a URL, and the failure has to be explicit:
	// falling back to a generated value would give the restaurant a permanent public address
	// nobody chose, and truncating to "" would collide with every other such restaurant.
	for _, name := range []string{"!!!", "***", "   ", "###"} {
		if _, appErr := resolveRestaurantSlug(name, ""); appErr == nil {
			t.Errorf("resolveRestaurantSlug(%q, \"\"): want a validation error, got none", name)
		} else if appErr.ErrorCode != response.ErrCodeValidation {
			t.Errorf("resolveRestaurantSlug(%q, \"\"): code %q, want %q",
				name, appErr.ErrorCode, response.ErrCodeValidation)
		}
	}

	// An explicitly supplied unusable slug fails too, and says so about the slug rather than
	// about the name -- the operator supplied one, so telling them to supply one is useless.
	_, appErr := resolveRestaurantSlug("Perfectly Fine Name", "!!!")
	if appErr == nil {
		t.Fatal("an unusable supplied slug was accepted")
	}
	if !strings.Contains(appErr.ErrorMessage, "slug") {
		t.Errorf("message does not mention the slug: %q", appErr.ErrorMessage)
	}
}

func TestResolveRestaurantSlug_RefusesOverlongRatherThanTruncating(t *testing.T) {
	// restaurant.slug is VARCHAR(64). Truncating silently would hand two restaurants with
	// long, similar names the same URL -- and the first would lose it to the second.
	long := strings.Repeat("a", maxSlugLength+1)

	if _, appErr := resolveRestaurantSlug(long, ""); appErr == nil {
		t.Error("a slug longer than the column was accepted")
	}

	// The boundary itself is fine. Off-by-one here would refuse a legitimate name.
	atLimit := strings.Repeat("a", maxSlugLength)
	got, appErr := resolveRestaurantSlug(atLimit, "")
	if appErr != nil {
		t.Fatalf("a slug exactly at the limit was refused: %v", appErr)
	}
	if len(got) != maxSlugLength {
		t.Fatalf("got length %d, want %d", len(got), maxSlugLength)
	}
}

func TestResolveTimezone(t *testing.T) {
	// Validated on write, not on read. models.Restaurant.Location falls back to IST for an
	// unknown zone, so an unvalidated typo would make the daily order-number counter roll over
	// at the wrong hour with nothing anywhere saying why (DECISIONS.md D9).
	valid := []string{"Asia/Kolkata", "UTC", "Asia/Dubai", "America/New_York"}
	for _, tz := range valid {
		got, appErr := resolveTimezone(tz)
		if appErr != nil {
			t.Errorf("resolveTimezone(%q): unexpected error %v", tz, appErr)
			continue
		}
		if got != tz {
			t.Errorf("resolveTimezone(%q) = %q, want it unchanged", tz, got)
		}
	}

	// Omitted means the market default, not empty. The response echoes this value back, and
	// echoing "" would tell the operator the restaurant has no timezone when it has IST.
	got, appErr := resolveTimezone("   ")
	if appErr != nil {
		t.Fatalf("unexpected error for a blank timezone: %v", appErr)
	}
	if got != defaultTimezone {
		t.Fatalf("blank timezone = %q, want %q", got, defaultTimezone)
	}

	// "IST" is the interesting rejection: it is what someone types, it is not an IANA name,
	// and Location() would quietly fall back to Asia/Kolkata -- the right answer for the wrong
	// reason, which is exactly the class of bug this guard exists for.
	for _, tz := range []string{"IST", "Asia/Bengaluru", "GMT+5:30", "Mars/Olympus"} {
		if _, appErr := resolveTimezone(tz); appErr == nil {
			t.Errorf("resolveTimezone(%q): want a validation error, got none", tz)
		}
	}
}

func TestResolveCurrency(t *testing.T) {
	cases := map[string]string{
		"":      defaultCurrency,
		"   ":   defaultCurrency,
		"inr":   "INR",
		"INR":   "INR",
		" usd ": "USD",
	}
	for in, want := range cases {
		if got := resolveCurrency(in); got != want {
			t.Errorf("resolveCurrency(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPlanOnboardingTables_NilMeansNoFloor(t *testing.T) {
	// Onboarding without tables is legitimate: a restaurant that has not counted them yet adds
	// them from the panel, and the restaurant-level fallback QR works with none
	// (DECISIONS.md D4). It must not be an error and must not invent a default floor.
	labels, appErr := planOnboardingTables(nil)
	if appErr != nil {
		t.Fatalf("unexpected error: %v", appErr)
	}
	if len(labels) != 0 {
		t.Fatalf("got %d labels for a nil range, want none", len(labels))
	}
}

func TestPlanOnboardingTables_LabelsTheRangeInclusively(t *testing.T) {
	labels, appErr := planOnboardingTables(&types.RequestOnboardTables{Prefix: "T-", From: 1, To: 4})
	if appErr != nil {
		t.Fatalf("unexpected error: %v", appErr)
	}

	want := []string{"T-1", "T-2", "T-3", "T-4"}
	if len(labels) != len(want) {
		t.Fatalf("got %v, want %v", labels, want)
	}
	for i := range want {
		if labels[i] != want[i] {
			t.Fatalf("got %v, want %v", labels, want)
		}
	}

	// Both ends inclusive: 1..1 is one table, not zero. An exclusive upper bound would print
	// a floor's worth of stickers one short.
	single, appErr := planOnboardingTables(&types.RequestOnboardTables{From: 7, To: 7})
	if appErr != nil {
		t.Fatalf("unexpected error: %v", appErr)
	}
	if len(single) != 1 || single[0] != "7" {
		t.Fatalf("got %v, want [7]", single)
	}
}

func TestPlanOnboardingTables_RefusesAnInvertedOrOversizedRange(t *testing.T) {
	if _, appErr := planOnboardingTables(&types.RequestOnboardTables{From: 10, To: 2}); appErr == nil {
		t.Error("an inverted range was accepted")
	}

	// The same cap serviceTable.BulkCreate uses. Without it, from:1 to:999 would generate 999
	// QR tokens on one request -- and no real restaurant has that many tables.
	over := &types.RequestOnboardTables{From: 1, To: maxBulkTables + 1}
	if _, appErr := planOnboardingTables(over); appErr == nil {
		t.Errorf("a range of %d tables was accepted, cap is %d", maxBulkTables+1, maxBulkTables)
	}

	// The cap itself is allowed.
	at := &types.RequestOnboardTables{From: 1, To: maxBulkTables}
	labels, appErr := planOnboardingTables(at)
	if appErr != nil {
		t.Fatalf("a range exactly at the cap was refused: %v", appErr)
	}
	if len(labels) != maxBulkTables {
		t.Fatalf("got %d labels, want %d", len(labels), maxBulkTables)
	}
}

func TestValueOr_DistinguishesOmittedFromZero(t *testing.T) {
	// The bug this guards against: an onboarding call that omits tax_bps must inherit the 5%
	// GST default, while one that explicitly sends 0 must produce a tax-free restaurant.
	// Collapsing the two -- the mistake a plain int field would force -- makes every
	// restaurant onboarded through an incomplete form quietly tax-free.
	if got := valueOr[int](nil, defaultTaxBps); got != defaultTaxBps {
		t.Errorf("omitted tax = %d, want the default %d", got, defaultTaxBps)
	}

	zero := 0
	if got := valueOr(&zero, defaultTaxBps); got != 0 {
		t.Errorf("explicit zero tax = %d, want 0", got)
	}

	explicit := 1800
	if got := valueOr(&explicit, defaultTaxBps); got != explicit {
		t.Errorf("explicit tax = %d, want %d", got, explicit)
	}
}

func TestTableSeats_ToleratesANilRange(t *testing.T) {
	if got := tableSeats(nil); got != nil {
		t.Errorf("tableSeats(nil) = %v, want nil", got)
	}

	seats := 4
	got := tableSeats(&types.RequestOnboardTables{From: 1, To: 2, Seats: &seats})
	if got == nil || *got != seats {
		t.Errorf("tableSeats did not carry the seat count through: %v", got)
	}
}

func TestPublicURLHelpers_TolerateATrailingSlashOnTheBase(t *testing.T) {
	// app.diner_base_url is operator-supplied and gets a trailing slash roughly half the time.
	// A doubled slash in a QR URL is not merely ugly: it is baked into printed stickers, and
	// some proxies do not normalise it.
	for _, base := range []string{"https://order.example.com", "https://order.example.com/"} {
		if got := tableQRURL(base, "tok123"); got != "https://order.example.com/t/tok123" {
			t.Errorf("tableQRURL(%q, ...) = %q", base, got)
		}
		if got := restaurantLandingURL(base, "spice-garden"); got != "https://order.example.com/r/spice-garden" {
			t.Errorf("restaurantLandingURL(%q, ...) = %q", base, got)
		}
	}
}
