package services

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"tablex/internal/models"
	"tablex/internal/response"
	"tablex/internal/types"
	"tablex/internal/utils"
)

type serviceSession struct {
	Access *ServiceAccess
}

// NewServiceSession builds the QR-scan and guest-session service.
func NewServiceSession(access *ServiceAccess) ServiceSessionMethods {
	return &serviceSession{Access: access}
}

// ScanTable turns a scanned QR token into a session plus the entire menu.
//
// One response rather than three (session, then restaurant, then menu) because this is the
// only thing standing between a diner scanning and seeing food. It is the request that
// decides whether the product feels fast, and PRD 3 measures exactly that.
func (s *serviceSession) ScanTable(
	ctx context.Context,
	qrToken, userAgent string,
) (*types.ResponseScanTable, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	table, err := s.Access.Repositories.Table.GetByQRToken(ctx, qrToken)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// A peeled-off, rotated or mistyped QR. The message points at the recovery action
			// rather than naming the token, because the diner is sitting at a table holding a
			// phone and "ask staff" is the entire fix (DECISIONS.md D4).
			log.Warnf("[ScanTable] unknown qr token presented")
			return nil, response.ErrQRTokenInvalid
		}
		log.Errorf("[ScanTable] token lookup failed: %+v", err)
		return nil, response.ErrTableFetchFailed
	}

	if table.Status != models.EntityStatusActive {
		return nil, response.ErrTableInactive
	}

	return s.startSession(ctx, table, userAgent)
}

// SelectTable claims a table from the restaurant-level fallback landing page.
//
// The fallback exists because table QR stickers get peeled off, spilled on, and swapped
// between tables. A single QR taped to the counter keeps the restaurant taking orders on a
// bad night (DECISIONS.md D4).
func (s *serviceSession) SelectTable(
	ctx context.Context,
	slug string,
	req *types.RequestSelectTable,
	userAgent string,
) (*types.ResponseScanTable, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	restaurant, err := s.Access.Repositories.Restaurant.GetBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrRestaurantNotFound
		}
		log.Errorf("[SelectTable] slug lookup failed: %+v", err)
		return nil, response.ErrRestaurantFetchFailed
	}
	if restaurant.Status != models.EntityStatusActive {
		return nil, response.ErrRestaurantInactive
	}

	// Scoped to the restaurant resolved from the slug, so a table UID from another restaurant
	// cannot be claimed through this endpoint.
	table, err := s.Access.Repositories.Table.GetByUID(ctx, restaurant.ID, req.TableUID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrTableNotFound
		}
		log.Errorf("[SelectTable] table lookup failed: %+v", err)
		return nil, response.ErrTableFetchFailed
	}
	if table.Status != models.EntityStatusActive {
		return nil, response.ErrTableInactive
	}

	return s.startSession(ctx, table, userAgent)
}

// startSession creates the guest session and assembles the scan response.
func (s *serviceSession) startSession(
	ctx context.Context,
	table *models.RestaurantTable,
	userAgent string,
) (*types.ResponseScanTable, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	restaurant, appErr := loadActiveRestaurant(ctx, s.Access, table.RestaurantID)
	if appErr != nil {
		return nil, appErr
	}

	menu, appErr := loadPublicMenu(ctx, s.Access, restaurant)
	if appErr != nil {
		return nil, appErr
	}

	// A fresh session per scan rather than reusing one for the table. Two diners at the same
	// table must get separate sessions, or one would see the other's orders as their own.
	session := &models.GuestSession{
		UID:          utils.GenerateUID(utils.UIDPrefixGuest),
		RestaurantID: restaurant.ID,
		TableID:      table.ID,
		Token:        utils.GenerateSessionToken(),
		UserAgent:    truncateUserAgent(userAgent),
		ExpiresAt:    time.Now().UTC().Add(s.Access.Cfg.Guest.SessionTTL),
	}

	if err := s.Access.Repositories.GuestSession.Create(ctx, nil, session); err != nil {
		log.Errorf("[startSession] insert failed for table %s: %+v", table.UID, err)
		return nil, response.ErrInternal
	}

	log.Infof("[startSession] session %s opened at table %s (%s)", session.UID, table.Label, restaurant.Slug)

	return &types.ResponseScanTable{
		Session: types.GuestSessionView{
			UID: session.UID,
			// The only time this token is ever returned. Every later diner request presents it.
			Token:     session.Token,
			ExpiresAt: session.ExpiresAt,
		},
		Table: toTableView(table),
		Menu:  *menu,
	}, nil
}

// Authenticate resolves a guest bearer token into a principal.
func (s *serviceSession) Authenticate(
	ctx context.Context,
	token string,
) (*GuestPrincipal, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if token == "" {
		return nil, response.ErrSessionMissing
	}

	session, err := s.Access.Repositories.GuestSession.GetByToken(ctx, token)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrSessionInvalid
		}
		log.Errorf("[Authenticate] session lookup failed: %+v", err)
		return nil, response.ErrInternal
	}

	// Expiry is a distinct error from invalidity so the diner app can say "scan the QR again"
	// rather than showing a generic failure on a session that simply aged out mid-visit.
	//
	// The session is deliberately NOT extended on each request: sliding the expiry forward
	// would make it unbounded for any tab left open, which defeats the point of having one.
	if session.Expired(time.Now().UTC()) {
		return nil, response.ErrSessionExpired
	}

	principal := &GuestPrincipal{
		SessionID:    session.ID,
		SessionUID:   session.UID,
		RestaurantID: session.RestaurantID,
		TableID:      session.TableID,
	}

	// GetByToken preloads both, so this costs nothing extra. Guarded anyway: a nil preload
	// would otherwise panic on a row whose foreign key was broken by a manual edit.
	if session.Restaurant != nil {
		principal.RestaurantUID = session.Restaurant.UID
	}
	if session.Table != nil {
		principal.TableLabel = session.Table.Label
	}

	return principal, nil
}

// truncateUserAgent bounds what is stored.
//
// The value is attacker-controlled and only kept for support ("which phone was this?"), so a
// pathological 8KB header should not become an 8KB row.
func truncateUserAgent(ua string) string {
	const max = 400
	if len(ua) > max {
		return ua[:max]
	}
	return ua
}
