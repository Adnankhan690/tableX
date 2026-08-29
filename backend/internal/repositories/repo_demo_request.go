package repositories

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"tablex/internal/models"
)

type repositoryDemoRequest struct {
	*RepositoryAccess
}

func NewRepositoryDemoRequest(access *RepositoryAccess) RepositoryDemoRequestMethods {
	return &repositoryDemoRequest{RepositoryAccess: access}
}

// whereDemoPhone is the only lookup this table has.
const whereDemoPhone = "phone = ?"

func (r *repositoryDemoRequest) Create(ctx context.Context, req *models.DemoRequest) error {
	err := r.conn(nil).WithContext(ctx).Create(req).Error
	if err != nil {
		// Logged at Warn rather than Error when it is the uniqueness constraint: the second
		// submission of the same number is an ordinary event on a public form, not a fault, and
		// an ERROR line per duplicate would train whoever reads the log to ignore the level.
		if IsUniqueViolation(err) {
			r.Logger.With(ctx).Warnf("[CreateDemoRequest] phone already booked: %v", err)
		} else {
			r.Logger.With(ctx).Errorf("[CreateDemoRequest] phone=%q: %v", req.Phone, err)
		}
		return err
	}
	return nil
}

// GetByPhone returns the demo request against a number, or (nil, nil) when there is none.
//
// The absent case is not an error here, because only the service knows what it means -- for the
// booking path a missing row is the happy case.
func (r *repositoryDemoRequest) GetByPhone(ctx context.Context, phone string) (*models.DemoRequest, error) {
	var req models.DemoRequest
	err := r.conn(nil).WithContext(ctx).Where(whereDemoPhone, phone).First(&req).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		r.Logger.With(ctx).Errorf("[GetDemoRequestByPhone] phone=%q: %v", phone, err)
		return nil, err
	}
	return &req, nil
}

// IsUniqueViolation reports whether err is a unique-constraint rejection.
//
// String matching rather than a driver-specific error code, deliberately. The application runs on
// Postgres and the unit tests run on SQLite (internal/db), and the two report this differently --
// pgx as SQLSTATE 23505, modernc's SQLite as "UNIQUE constraint failed". A check that only
// understands one of them is a check that passes in tests and misses in production, or the
// reverse. Both spellings are stable strings in their respective drivers.
//
// Exported because the demo service reads it to turn a lost race into the same polite 409 the
// pre-check produces, and that mapping is the service's job rather than this layer's.
func IsUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "23505") ||
		strings.Contains(msg, "duplicate key value") ||
		strings.Contains(msg, "unique constraint failed")
}
