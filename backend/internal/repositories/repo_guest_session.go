package repositories

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	"tablex/internal/models"
)

// Guest sessions: the anonymous diner identity created on first QR scan (DECISIONS.md D5).
//
// Nothing here is restaurant-scoped, and that is not an oversight. A diner arrives holding
// a token and nothing else -- this row is what says which restaurant and which table they
// are at, so scoping the lookup by the answer it exists to produce is impossible. The
// tenant boundary on the diner API is enforced one layer up, where the service compares
// the session's restaurant against whatever the request claims to be about (DECISIONS.md
// D3, D5).
//
// Error and logging conventions are the package's: wrap with %w so the service can map
// gorm.ErrRecordNotFound itself, and never log an absence. The second rule earns its keep
// here more than anywhere else -- these lookups sit on a public endpoint, so logging
// unknown tokens would hand any passer-by a way to fill the error stream.

// repositoryGuestSession is data access for diner sessions.
type repositoryGuestSession struct {
	*RepositoryAccess
}

// NewRepositoryGuestSession builds the guest session repository over the shared Access.
func NewRepositoryGuestSession(access *RepositoryAccess) RepositoryGuestSessionMethods {
	return &repositoryGuestSession{RepositoryAccess: access}
}

// Create inserts a session, inside the caller's transaction when there is one. The scan
// flow creates the session as part of a larger unit of work, and a session row that
// outlives a failed scan is a token issued for a request that never completed.
func (a *repositoryGuestSession) Create(ctx context.Context, tx *gorm.DB, session *models.GuestSession) error {
	if err := a.conn(tx).WithContext(ctx).Create(session).Error; err != nil {
		a.Logger.With(ctx).Errorf("[Create] guest session restaurant=%d table=%d: %v", session.RestaurantID, session.TableID, err)
		return fmt.Errorf("create guest session: %w", err)
	}
	return nil
}

// GetByToken resolves the bearer token every diner request carries.
//
// Table and Restaurant are preloaded because this read never happens alone: the caller
// immediately needs the table label to echo back and the restaurant's tax and
// service-charge rates to price anything, so three queries per diner request collapse into
// one. This is the hottest read on the public path (PRD 7).
//
// Expiry is not checked. Whether a stale session means "rescan the QR" or a flat refusal is
// the service's decision, made with models.GuestSession.Expired -- and a repository that
// hid expired rows would leave the service unable to tell an expired token from a forged
// one, which are different answers to the diner.
func (a *repositoryGuestSession) GetByToken(ctx context.Context, token string) (*models.GuestSession, error) {
	var session models.GuestSession
	err := a.conn(nil).WithContext(ctx).
		Preload("Table").
		Preload("Restaurant").
		Where("token = ?", token).
		First(&session).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			// The token itself is never logged: it is the whole of the diner's identity, so
			// a log line carrying it is a credential in a log file (DECISIONS.md D5).
			a.Logger.With(ctx).Errorf("[GetByToken] guest session lookup: %v", err)
		}
		return nil, fmt.Errorf("get guest session by token: %w", err)
	}
	return &session, nil
}

// GetByUID looks a session up by the identifier that is safe to appear in an API response
// or a log line, unlike the token. No preloads: the callers are administrative -- tracing
// an order back to the sitting that placed it -- and already hold the restaurant.
func (a *repositoryGuestSession) GetByUID(ctx context.Context, uid string) (*models.GuestSession, error) {
	var session models.GuestSession
	if err := a.conn(nil).WithContext(ctx).Where(whereUID, uid).First(&session).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetByUID] guest session uid=%q: %v", uid, err)
		}
		return nil, fmt.Errorf("get guest session by uid: %w", err)
	}
	return &session, nil
}

// Extend pushes a session's expiry out, so a diner mid-meal does not lose the tracking
// screen they were promised (DECISIONS.md D5).
//
// One column, not a struct save: a sliding expiry rides along on some other request, and
// writing back a whole row read earlier in that request would clobber anything changed
// since.
func (a *repositoryGuestSession) Extend(ctx context.Context, id int32, expiresAt time.Time) error {
	res := a.conn(nil).WithContext(ctx).Model(&models.GuestSession{}).
		Where(whereID, id).
		Update("expires_at", expiresAt)
	if res.Error != nil {
		a.Logger.With(ctx).Errorf("[Extend] guest session id=%d: %v", id, res.Error)
		return fmt.Errorf("extend guest session: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		// DeleteExpired reaped the session between resolving the token and extending it.
		// Returned as the sentinel a read would have produced, so the service can send the
		// diner back to the QR code instead of continuing with an identity that is gone.
		return fmt.Errorf("extend guest session: %w", gorm.ErrRecordNotFound)
	}
	return nil
}

// DeleteExpired reaps sessions whose tokens can no longer authenticate, returning the count
// for the caller to log.
//
// A hard delete rather than a status flag: the token is the entire identity, so a row that
// can never be presented again has no reader left. Orders survive it --
// orders.guest_session_id is ON DELETE SET NULL, so an order keeps its own totals and
// snapshots and only the link back to the sitting goes, which is precisely the thing that
// expired (DECISIONS.md D8).
func (a *repositoryGuestSession) DeleteExpired(ctx context.Context, before time.Time) (int64, error) {
	// <= rather than <, to agree with models.GuestSession.Expired, which treats
	// now == expires_at as already expired. With < a row landing exactly on the boundary
	// would be unusable to every caller and yet never collected.
	res := a.conn(nil).WithContext(ctx).
		Where("expires_at <= ?", before).
		Delete(&models.GuestSession{})
	if res.Error != nil {
		a.Logger.With(ctx).Errorf("[DeleteExpired] before=%s: %v", before.Format(time.RFC3339), res.Error)
		return 0, fmt.Errorf("delete expired guest sessions: %w", res.Error)
	}
	return res.RowsAffected, nil
}
