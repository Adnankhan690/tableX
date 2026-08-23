package repositories

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"tablex/internal/models"
)

// repositoryTable is data access for physical tables and their QR tokens.
//
// As elsewhere in this package: errors are wrapped with %w so gorm.ErrRecordNotFound
// survives for the service to map, and a missing row is not logged here -- a stale QR gets
// scanned regularly and is a 404 for the diner, not an incident.
type repositoryTable struct {
	*RepositoryAccess
}

// NewRepositoryTable builds the table repository over the shared Access.
func NewRepositoryTable(access *RepositoryAccess) RepositoryTableMethods {
	return &repositoryTable{RepositoryAccess: access}
}

func (a *repositoryTable) Create(ctx context.Context, tx *gorm.DB, table *models.RestaurantTable) error {
	if err := a.conn(tx).WithContext(ctx).Create(table).Error; err != nil {
		// The qr_token is never logged: it is a capability, and possession of it authorises
		// ordering at this table (DECISIONS.md D4).
		a.Logger.With(ctx).Errorf("[Create] table label=%q restaurant=%d: %v", table.Label, table.RestaurantID, err)
		return fmt.Errorf("create table: %w", err)
	}
	return nil
}

func (a *repositoryTable) CreateBatch(ctx context.Context, tx *gorm.DB, tables []*models.RestaurantTable) error {
	// GORM returns ErrEmptySlice for a zero-length create. Onboarding zero tables is a
	// no-op rather than a failure, and absorbing it here keeps the check out of every
	// caller.
	if len(tables) == 0 {
		return nil
	}

	// One multi-row INSERT rather than a batched loop. The bulk-create request is bounded
	// to labels 1..999 by its binding tags, which stays well inside Postgres's parameter
	// limit, so batching would only add round trips. It also means a duplicate label
	// anywhere in the range fails the whole statement -- a half-created floor is worse to
	// clean up than a rejected request.
	if err := a.conn(tx).WithContext(ctx).Create(&tables).Error; err != nil {
		a.Logger.With(ctx).Errorf("[CreateBatch] %d tables for restaurant=%d: %v", len(tables), tables[0].RestaurantID, err)
		return fmt.Errorf("create tables in batch: %w", err)
	}

	a.Logger.With(ctx).Infof("[CreateBatch] inserted %d tables for restaurant=%d", len(tables), tables[0].RestaurantID)
	return nil
}

func (a *repositoryTable) GetByID(ctx context.Context, restaurantID, id int32) (*models.RestaurantTable, error) {
	var table models.RestaurantTable
	err := a.conn(nil).WithContext(ctx).
		Where(whereRestaurantAndID, restaurantID, id).
		First(&table).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetByID] table id=%d restaurant=%d: %v", id, restaurantID, err)
		}
		return nil, fmt.Errorf("get table by id: %w", err)
	}
	return &table, nil
}

func (a *repositoryTable) GetByUID(ctx context.Context, restaurantID int32, uid string) (*models.RestaurantTable, error) {
	var table models.RestaurantTable
	err := a.conn(nil).WithContext(ctx).
		Where(whereRestaurantAndUID, restaurantID, uid).
		First(&table).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[GetByUID] table uid=%q restaurant=%d: %v", uid, restaurantID, err)
		}
		return nil, fmt.Errorf("get table by uid: %w", err)
	}
	return &table, nil
}

// GetByQRToken resolves a scanned QR.
//
// Unscoped by design: the token is the only thing the diner presents, and identifying the
// restaurant is what the scan is for (DECISIONS.md D4). Being unguessable is what makes
// that safe -- 160 bits of entropy, not a table id.
//
// The restaurant is joined rather than fetched in a second call because every caller needs
// it: a scan answers with the table, the restaurant header and the whole menu in one
// response, and this is the request that decides whether the product feels fast. The join
// cannot drop the row -- restaurant_id is NOT NULL behind a foreign key.
func (a *repositoryTable) GetByQRToken(ctx context.Context, qrToken string) (*models.RestaurantTable, error) {
	var table models.RestaurantTable
	err := a.conn(nil).WithContext(ctx).
		Joins("Restaurant").
		Where(models.TableNameRestaurantTable+".qr_token = ?", qrToken).
		First(&table).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			// The token itself stays out of the log line for the same reason it stays out of
			// JSON: it is a bearer capability.
			a.Logger.With(ctx).Errorf("[GetByQRToken] qr lookup failed: %v", err)
		}
		return nil, fmt.Errorf("get table by qr token: %w", err)
	}
	return &table, nil
}

// ListByRestaurant lists the floor.
//
// includeInactive is the admin's "show everything" switch and returns archived rows too,
// because an archived table that cannot be seen cannot be restored. Diner-facing callers
// pass false and therefore never reach a table that is not taking orders.
func (a *repositoryTable) ListByRestaurant(ctx context.Context, restaurantID int32, includeInactive bool) ([]*models.RestaurantTable, error) {
	q := a.conn(nil).WithContext(ctx).Where(whereRestaurant, restaurantID)
	if !includeInactive {
		q = q.Where("status = ?", models.EntityStatusActive)
	}

	var tables []*models.RestaurantTable
	// Lexical ordering, so "T-10" precedes "T-2". Accepted rather than worked around:
	// labels are free-form text by design ("Patio 2", "Bar"), so a numeric sort would need
	// a separate ordering column for staff to maintain by hand, and the floor view is a
	// grid the admin scans rather than a sequence they step through.
	if err := q.Order("label ASC").Find(&tables).Error; err != nil {
		a.Logger.With(ctx).Errorf("[ListByRestaurant] tables restaurant=%d: %v", restaurantID, err)
		return nil, fmt.Errorf("list tables by restaurant: %w", err)
	}
	return tables, nil
}

// UpdateFields is keyed by primary key alone, so the caller must have resolved the row
// through one of the scoped getters first. That is the pattern throughout this package:
// scope is proven on the read, and the write then works from an id the caller has already
// established belongs to its tenant (DECISIONS.md D3).
func (a *repositoryTable) UpdateFields(ctx context.Context, id int32, fields map[string]any) (*models.RestaurantTable, error) {
	// GORM emits no statement for an empty assignment map, so without this an unchanged
	// PATCH would come back as a missing table.
	if len(fields) == 0 {
		return a.getByIDUnscoped(ctx, id)
	}

	res := a.conn(nil).WithContext(ctx).Model(&models.RestaurantTable{}).Where(whereID, id).Updates(fields)
	if res.Error != nil {
		a.Logger.With(ctx).Errorf("[UpdateFields] table id=%d: %v", id, res.Error)
		return nil, fmt.Errorf("update table fields: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		// Same sentinel a read would produce, so the service needs one mapping rather than a
		// second one for "updated nothing".
		return nil, fmt.Errorf("update table fields: %w", gorm.ErrRecordNotFound)
	}

	// Re-read: a QR rotation returns this straight to the print sheet, and it must carry the
	// token that was actually written rather than the one the caller believes it sent.
	return a.getByIDUnscoped(ctx, id)
}

// getByIDUnscoped reads back a row the caller has already scoped. Kept private and
// deliberately not part of the interface, so no service can reach an unscoped read by
// accident.
func (a *repositoryTable) getByIDUnscoped(ctx context.Context, id int32) (*models.RestaurantTable, error) {
	var table models.RestaurantTable
	if err := a.conn(nil).WithContext(ctx).Where(whereID, id).First(&table).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			a.Logger.With(ctx).Errorf("[getByIDUnscoped] table id=%d: %v", id, err)
		}
		return nil, fmt.Errorf("get table by id: %w", err)
	}
	return &table, nil
}

// LabelExists is advisory: it turns a duplicate label into a readable 409 instead of a
// constraint violation. The unique index on (restaurant_id, label) is what actually holds
// when two creates race.
func (a *repositoryTable) LabelExists(ctx context.Context, restaurantID int32, label string, excludeID int32) (bool, error) {
	q := a.conn(nil).WithContext(ctx).
		Model(&models.RestaurantTable{}).
		Where(whereRestaurant, restaurantID).
		Where("label = ?", label)
	// excludeID is the row being edited, so a table that keeps its own label through an
	// update does not collide with itself. Zero means there is no row to exclude yet.
	if excludeID > 0 {
		q = q.Where("id <> ?", excludeID)
	}

	var count int64
	if err := q.Count(&count).Error; err != nil {
		a.Logger.With(ctx).Errorf("[LabelExists] label=%q restaurant=%d: %v", label, restaurantID, err)
		return false, fmt.Errorf("count tables by label: %w", err)
	}
	return count > 0, nil
}

// CountLiveOrders returns per-table counts for the whole restaurant in one grouped query.
//
// One query, not one per table: this backs the admin floor view, which renders every table
// at once, so a per-table count would mean thirty round trips to paint one screen. It also
// means every count in the map is taken at the same instant, so the view cannot show a
// total that never existed.
func (a *repositoryTable) CountLiveOrders(ctx context.Context, restaurantID int32, statuses []models.OrderStatus) (map[int32]int64, error) {
	var rows []struct {
		TableID    int32 `gorm:"column:table_id"`
		LiveOrders int64 `gorm:"column:live_orders"`
	}

	q := a.conn(nil).WithContext(ctx).
		Model(&models.Order{}).
		Select("table_id, COUNT(*) AS live_orders").
		Where(whereRestaurant, restaurantID)
	// An empty status set means every status, matching OrderListFilter so the two admin
	// queries do not disagree about what "no filter" means.
	if len(statuses) > 0 {
		q = q.Where("status IN ?", statuses)
	}

	if err := q.Group("table_id").Scan(&rows).Error; err != nil {
		a.Logger.With(ctx).Errorf("[CountLiveOrders] restaurant=%d: %v", restaurantID, err)
		return nil, fmt.Errorf("count live orders by table: %w", err)
	}

	// Tables with nothing live are absent from the group-by and stay absent from the map. A
	// missing key already reads as zero, so filling one in for every table would mean
	// loading the table list here purely to write zeroes the caller cannot distinguish.
	counts := make(map[int32]int64, len(rows))
	for _, row := range rows {
		counts[row.TableID] = row.LiveOrders
	}
	return counts, nil
}
