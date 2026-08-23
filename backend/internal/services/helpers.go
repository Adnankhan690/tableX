package services

import (
	"sort"
	"strings"

	"tablex/internal/models"
	"tablex/internal/types"
	"tablex/internal/utils"
)

// Compile-time proof that every implementation satisfies its frozen interface. Without
// these, a signature drift would only surface at the NewServices call site with a far less
// specific error.
var (
	_ ServiceAuthMethods       = (*serviceAuth)(nil)
	_ ServiceRestaurantMethods = (*serviceRestaurant)(nil)
	_ ServiceTableMethods      = (*serviceTable)(nil)
	_ ServiceMenuMethods       = (*serviceMenu)(nil)
	_ ServiceSessionMethods    = (*serviceSession)(nil)
	_ ServiceOrderMethods      = (*ServiceOrder)(nil)
	_ ServicePaymentMethods    = (*servicePayment)(nil)
	_ ServiceStatsMethods      = (*serviceStats)(nil)
)

// money builds the wire representation of an amount.
//
// The single place a minor-unit integer becomes a display string on the server. Both halves
// travel together so the client never does currency arithmetic or reimplements Indian digit
// grouping (DECISIONS.md D7).
func money(minor int64, currency string) types.Money {
	if currency == "" {
		currency = "INR"
	}
	return types.Money{
		Minor:    minor,
		Currency: currency,
		Display:  utils.FormatINR(minor),
	}
}

// --- Restaurant ---

// toRestaurantSummary builds the anonymous-facing view.
//
// Narrow on purpose: it omits the UPI VPA, the GST number, the tax configuration and the
// status, because this object is served to unauthenticated callers. Having two DTOs rather
// than one with omitted fields is what makes that guarantee structural instead of a thing
// someone has to remember.
func toRestaurantSummary(r *models.Restaurant) types.RestaurantSummary {
	return types.RestaurantSummary{
		UID:         r.UID,
		Name:        r.Name,
		Slug:        r.Slug,
		Description: r.Description,
		LogoURL:     r.LogoURL,
		Address:     r.Address,
		Phone:       r.Phone,
		Currency:    r.Currency,
	}
}

// toRestaurantSettings builds the staff-only view, including the payout configuration.
func toRestaurantSettings(r *models.Restaurant) *types.RestaurantSettings {
	return &types.RestaurantSettings{
		RestaurantSummary: toRestaurantSummary(r),
		Timezone:          r.Timezone,
		GSTNumber:         r.GSTNumber,
		TaxBps:            r.TaxBps,
		ServiceChargeBps:  r.ServiceChargeBps,
		UPIVPA:            r.UPIVPA,
		UPIPayeeName:      r.UPIPayeeName,
		PaymentProvider:   string(r.PaymentProvider),
		Status:            string(r.Status),
	}
}

// --- Tables ---

func toTableView(t *models.RestaurantTable) types.TableView {
	return types.TableView{UID: t.UID, Label: t.Label}
}

// toTableInfo builds the admin view. qrURL is passed in rather than derived here because
// building it needs the configured diner base URL, which this helper has no access to.
func toTableInfo(t *models.RestaurantTable, qrURL string, liveOrders int64) types.TableInfo {
	return types.TableInfo{
		UID:            t.UID,
		Label:          t.Label,
		Seats:          t.Seats,
		Status:         string(t.Status),
		QRURL:          qrURL,
		LiveOrderCount: liveOrders,
	}
}

// --- Menu ---

func toMenuItemView(item *models.MenuItem, categoryUID, currency string) types.MenuItemView {
	return types.MenuItemView{
		UID:          item.UID,
		Name:         item.Name,
		Description:  item.Description,
		ImageURL:     item.ImageURL,
		Price:        money(item.PriceMinor, currency),
		FoodType:     string(item.FoodType),
		SpiceLevel:   string(item.SpiceLevel),
		IsAvailable:  item.IsAvailable,
		IsBestseller: item.IsBestseller,
		PrepTimeMins: item.PrepTimeMins,
		CategoryUID:  categoryUID,
	}
}

func toAdminMenuItemView(item *models.MenuItem, categoryUID, currency string) types.AdminMenuItemView {
	return types.AdminMenuItemView{
		MenuItemView: toMenuItemView(item, categoryUID, currency),
		Status:       string(item.Status),
		SortOrder:    item.SortOrder,
	}
}

// buildPublicMenu assembles the diner menu from separately-fetched categories and items.
//
// Takes both lists and joins them in Go rather than issuing one item query per category:
// on a 3G connection the round trips cost more than the bytes do, and PRD 7 makes menu load
// time a product requirement. Callers fetch with exactly two queries.
//
// Items whose category is missing from the list are dropped -- that happens when a category
// is archived while its items are not, and surfacing an item with no section to sit in
// would render it unreachable at the bottom of the page.
func buildPublicMenu(
	restaurant *models.Restaurant,
	categories []*models.MenuCategory,
	items []*models.MenuItem,
) *types.ResponseMenu {
	idToUID := make(map[int32]string, len(categories))
	for _, c := range categories {
		idToUID[c.ID] = c.UID
	}

	byCategory := make(map[string][]types.MenuItemView, len(categories))
	for _, item := range items {
		uid, ok := idToUID[item.CategoryID]
		if !ok {
			continue
		}
		byCategory[uid] = append(byCategory[uid], toMenuItemView(item, uid, restaurant.Currency))
	}

	views := make([]types.MenuCategoryView, 0, len(categories))
	for _, c := range categories {
		// An empty category is omitted. A diner tapping "Desserts" and finding nothing reads
		// as a broken page; the restaurant simply has none listed.
		lines := byCategory[c.UID]
		if len(lines) == 0 {
			continue
		}
		views = append(views, types.MenuCategoryView{
			UID:         c.UID,
			Name:        c.Name,
			Description: c.Description,
			Items:       lines,
		})
	}

	return &types.ResponseMenu{
		Restaurant:       toRestaurantSummary(restaurant),
		Categories:       views,
		TaxBps:           restaurant.TaxBps,
		ServiceChargeBps: restaurant.ServiceChargeBps,
	}
}

// --- Orders ---

func toOrderItemView(item *models.OrderItem, currency string) types.OrderItemView {
	return types.OrderItemView{
		UID:       item.UID,
		Name:      item.NameSnapshot,
		UnitPrice: money(item.UnitPriceMinor, currency),
		Quantity:  item.Quantity,
		Total:     money(item.TotalMinor, currency),
		FoodType:  string(item.FoodType),
		Note:      item.Note,
		Status:    string(item.Status),
	}
}

// toOrderView builds the order representation both audiences receive.
//
// actor decides only what NextStatuses contains -- the rest is identical for a diner and for
// staff, because there is nothing on an order a diner may not see about their own order.
//
// NextStatuses and CanGuestCancel are computed here, server-side, precisely so the admin
// panel renders the buttons that will actually work rather than reimplementing the state
// machine in TypeScript and drifting from it (DECISIONS.md D1, D6).
func toOrderView(
	order *models.Order,
	events []*models.OrderStatusEvent,
	tableLabel string,
	actor Actor,
) types.OrderView {
	currency := order.Currency

	items := make([]types.OrderItemView, 0, len(order.Items))
	for i := range order.Items {
		items = append(items, toOrderItemView(&order.Items[i], currency))
	}

	if tableLabel == "" && order.Table != nil {
		tableLabel = order.Table.Label
	}

	view := types.OrderView{
		UID:         order.UID,
		OrderNumber: order.OrderNumber,
		Status:      string(order.Status),
		TableLabel:  tableLabel,
		Items:       items,
		Totals: types.OrderTotals{
			Subtotal:      money(order.SubtotalMinor, currency),
			Tax:           money(order.TaxMinor, currency),
			ServiceCharge: money(order.ServiceChargeMinor, currency),
			Discount:      money(order.DiscountMinor, currency),
			Total:         money(order.TotalMinor, currency),
		},
		PaymentMethod:  string(order.PaymentMethod),
		PaymentStatus:  string(order.PaymentStatus),
		CustomerName:   order.CustomerName,
		CustomerPhone:  order.CustomerPhone,
		Note:           order.Note,
		CancelReason:   order.CancelReason,
		PlacedAt:       order.PlacedAt,
		AcceptedAt:     order.AcceptedAt,
		PreparingAt:    order.PreparingAt,
		ReadyAt:        order.ReadyAt,
		ServedAt:       order.ServedAt,
		CompletedAt:    order.CompletedAt,
		CancelledAt:    order.CancelledAt,
		NextStatuses:   NextStatuses(order.Status, actor),
		CanGuestCancel: CanGuestCancel(order.Status),
	}

	if len(events) > 0 {
		timeline := make([]types.OrderStatusEventView, 0, len(events))
		for _, e := range events {
			timeline = append(timeline, types.OrderStatusEventView{
				Status:    string(e.ToStatus),
				ActorType: string(e.ActorType),
				Note:      e.Note,
				At:        e.CreatedAt,
			})
		}
		// Oldest first: this renders as a progress timeline, which reads downward in time.
		sort.SliceStable(timeline, func(i, j int) bool { return timeline[i].At.Before(timeline[j].At) })
		view.Timeline = timeline
	}

	return view
}

// --- Payments ---

func toPaymentView(p *models.Payment, qrPNG string, requiresManual bool) *types.PaymentView {
	return &types.PaymentView{
		UID:                        p.UID,
		Provider:                   string(p.Provider),
		Method:                     string(p.Method),
		Amount:                     money(p.AmountMinor, p.Currency),
		Status:                     string(p.Status),
		Reference:                  p.Reference,
		UPIIntentURL:               p.UPIIntentURL,
		QRPNGBase64:                qrPNG,
		ProviderOrderID:            p.ProviderOrderID,
		RequiresManualConfirmation: requiresManual,
		PaidAt:                     p.PaidAt,
		CreatedAt:                  p.CreatedAt,
	}
}

// --- Staff ---

// toStaffMember builds the staff view. There is no password field of any kind on the DTO,
// so a hash cannot leak by someone adding a field to the model.
func toStaffMember(s *models.StaffUser) types.StaffMember {
	return types.StaffMember{
		UID:         s.UID,
		Name:        s.Name,
		Email:       s.Email,
		Role:        string(s.Role),
		Status:      string(s.Status),
		LastLoginAt: s.LastLoginAt,
		CreatedAt:   s.CreatedAt,
	}
}

// --- Small shared utilities ---

// normalizeEmail lowercases and trims, so "  Owner@X.com " and "owner@x.com" are one
// account. Applied on both write and lookup, or the two would disagree.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// applyString stages a non-nil pointer field into a GORM update map.
//
// PATCH semantics: a nil pointer means "not supplied" and must leave the column alone,
// while a pointer to "" means "clear it". Collapsing those two would make it impossible to
// blank an optional field.
func applyString(fields map[string]any, column string, value *string) {
	if value != nil {
		fields[column] = strings.TrimSpace(*value)
	}
}

func applyInt(fields map[string]any, column string, value *int) {
	if value != nil {
		fields[column] = *value
	}
}

func applyBool(fields map[string]any, column string, value *bool) {
	if value != nil {
		fields[column] = *value
	}
}

func applyInt64(fields map[string]any, column string, value *int64) {
	if value != nil {
		fields[column] = *value
	}
}
