package repositories

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	"tablex/internal/models"
)

// repositoryStaff is data access for admin logins.
//
// As elsewhere in this package: errors are wrapped with %w so the service can still match
// gorm.ErrRecordNotFound, and a missing row is not logged as an error -- a failed login is
// a normal event, and logging one per attempt hands an attacker a way to fill the error
// stream.
type repositoryStaff struct {
	*RepositoryAccess
}

// NewRepositoryStaff builds the staff repository over the shared Access.
func NewRepositoryStaff(access *RepositoryAccess) RepositoryStaffMethods {
	return &repositoryStaff{RepositoryAccess: access}
}

func (a *repositoryStaff) Create(ctx context.Context, tx *gorm.DB, staff *models.StaffUser) error {
	if err := a.conn(tx).WithContext(ctx).Create(staff).Error; err != nil {
		// The email is logged, the hash is not: this line ends up in a shared log stream.
		a.Logger.With(ctx).Errorf("[Create] staff email=%q restaurant=%d: %v", staff.Email, staff.RestaurantID, err)
		return fmt.Errorf("create staff user: %w", err)
	}
	return nil
}

// GetByEmail compares the address exactly as stored. Case folding is the service's job,
// applied on the way in as well as on lookup -- a repository that lowercased only on read
// would happily match a row it could never have written.
func (a *repositoryStaff) GetByEmail(ctx context.Context, restaurantID int32, email string) (*models.StaffUser, error) {
	var staff models.StaffUser
	err := a.conn(nil).WithContext(ctx).
		Where(whereRestaurant, restaurantID).
		Where("email = ?", email).
		First(&staff).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetByEmail] staff email=%q restaurant=%d: %v", email, restaurantID, err)
		}
		return nil, fmt.Errorf("get staff user by email: %w", err)
	}
	return &staff, nil
}

// GetByEmailAnyRestaurant returns every login for an address, because login is the one
// path with no tenant scope yet: the caller has an email and a password and nothing else.
//
// Returning the whole set rather than the first row is what lets the service refuse an
// ambiguous login outright. Signing someone into whichever restaurant happened to sort
// first would be worse than an error -- they would be looking at another restaurant's
// orders and have no way to tell.
func (a *repositoryStaff) GetByEmailAnyRestaurant(ctx context.Context, email string) ([]*models.StaffUser, error) {
	var staff []*models.StaffUser
	// Ordered by id so the same email produces the same set in the same order on every
	// attempt. An unordered scan would make an ambiguity look intermittent, which is the
	// hardest kind of report to act on.
	//
	// Restaurant is preloaded because whichever candidate survives, the caller needs its
	// tenant immediately -- token claims carry the restaurant uid, and a login into a
	// suspended restaurant has to be refused. One extra query for the whole set beats one
	// per candidate.
	err := a.conn(nil).WithContext(ctx).
		Preload("Restaurant").
		Where("email = ?", email).
		Order("id ASC").
		Find(&staff).Error
	if err != nil {
		a.Logger.With(ctx).Errorf("[GetByEmailAnyRestaurant] staff email=%q: %v", email, err)
		return nil, fmt.Errorf("list staff users by email: %w", err)
	}
	// No match is an empty slice, not an error: "this email is not registered" and "the
	// password is wrong" must be indistinguishable to the caller, and that decision belongs
	// to the service.
	return staff, nil
}

func (a *repositoryStaff) GetByUID(ctx context.Context, restaurantID int32, uid string) (*models.StaffUser, error) {
	var staff models.StaffUser
	err := a.conn(nil).WithContext(ctx).
		Where(whereRestaurantAndUID, restaurantID, uid).
		First(&staff).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetByUID] staff uid=%q restaurant=%d: %v", uid, restaurantID, err)
		}
		return nil, fmt.Errorf("get staff user by uid: %w", err)
	}
	return &staff, nil
}

// GetByID is unscoped because its callers already hold a verified id from their own token
// -- refreshing a session, loading "me" -- and have no separate restaurantID to check it
// against. Anything resolving a uid supplied by a request must use GetByUID instead, which
// is scoped (DECISIONS.md D3).
func (a *repositoryStaff) GetByID(ctx context.Context, id int32) (*models.StaffUser, error) {
	var staff models.StaffUser
	if err := a.conn(nil).WithContext(ctx).Where(whereID, id).First(&staff).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetByID] staff id=%d: %v", id, err)
		}
		return nil, fmt.Errorf("get staff user by id: %w", err)
	}
	return &staff, nil
}

// ListByRestaurant returns every login, deactivated ones included. There is no
// includeInactive flag on purpose: this backs the owner's access-management screen, and a
// disabled account that has silently disappeared from the list is an account nobody
// remembers to remove.
func (a *repositoryStaff) ListByRestaurant(ctx context.Context, restaurantID int32) ([]*models.StaffUser, error) {
	var staff []*models.StaffUser
	err := a.conn(nil).WithContext(ctx).
		Where(whereRestaurant, restaurantID).
		Order("name ASC").
		Find(&staff).Error
	if err != nil {
		a.Logger.With(ctx).Errorf("[ListByRestaurant] staff restaurant=%d: %v", restaurantID, err)
		return nil, fmt.Errorf("list staff users by restaurant: %w", err)
	}
	return staff, nil
}

func (a *repositoryStaff) UpdateFields(ctx context.Context, id int32, fields map[string]any) (*models.StaffUser, error) {
	// GORM emits no statement for an empty assignment map, so without this an unchanged
	// PATCH would come back as a missing staff member.
	if len(fields) == 0 {
		return a.GetByID(ctx, id)
	}

	res := a.conn(nil).WithContext(ctx).Model(&models.StaffUser{}).Where(whereID, id).Updates(fields)
	if res.Error != nil {
		a.Logger.With(ctx).Errorf("[UpdateFields] staff id=%d: %v", id, res.Error)
		return nil, fmt.Errorf("update staff user fields: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return nil, fmt.Errorf("update staff user fields: %w", gorm.ErrRecordNotFound)
	}
	return a.GetByID(ctx, id)
}

// TouchLastLogin records a successful sign-in.
func (a *repositoryStaff) TouchLastLogin(ctx context.Context, id int32, at time.Time) error {
	// UpdateColumn, not Update: last_login_at is telemetry about the account, not a change
	// to it, and bumping updated_at would make every sign-in read as an edit in the owner's
	// audit view.
	res := a.conn(nil).WithContext(ctx).
		Model(&models.StaffUser{}).
		Where(whereID, id).
		UpdateColumn("last_login_at", at)
	if res.Error != nil {
		a.Logger.With(ctx).Errorf("[TouchLastLogin] staff id=%d: %v", id, res.Error)
		return fmt.Errorf("touch staff last login: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		// Warned, not returned as an error. The caller has already authenticated this staff
		// member, so a telemetry write that matched nothing means the row was deleted
		// mid-login -- worth investigating, but not worth failing a valid login over.
		a.Logger.With(ctx).Warnf("[TouchLastLogin] no staff row for id=%d", id)
	}
	return nil
}

// CountByRole counts rows with the role regardless of status, because the signature
// carries no status filter. A caller using this to refuse "remove the last owner" is
// therefore also counting deactivated owners, and should combine it with the status check
// it cares about rather than treating the count as "owners who can still log in".
func (a *repositoryStaff) CountByRole(ctx context.Context, restaurantID int32, role models.StaffRole) (int64, error) {
	var count int64
	err := a.conn(nil).WithContext(ctx).
		Model(&models.StaffUser{}).
		Where(whereRestaurant, restaurantID).
		Where("role = ?", role).
		Count(&count).Error
	if err != nil {
		a.Logger.With(ctx).Errorf("[CountByRole] staff role=%q restaurant=%d: %v", role, restaurantID, err)
		return 0, fmt.Errorf("count staff users by role: %w", err)
	}
	return count, nil
}
