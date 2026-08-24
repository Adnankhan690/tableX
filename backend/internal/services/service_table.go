package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"tablex/internal/models"
	"tablex/internal/payments"
	"tablex/internal/response"
	"tablex/internal/types"
	"tablex/internal/utils"
)

// maxBulkTables bounds a bulk-create range.
//
// A range of 1..99999 would insert a hundred thousand rows and generate as many QR tokens on
// one request. No real restaurant has more than a couple of hundred tables, so the cap costs
// nothing and removes the footgun.
const maxBulkTables = 200

// defaultQRSize is the pixel size for a printed table QR. Large enough to survive being
// printed on a small card and scanned at an angle in restaurant lighting.
const defaultQRSize = 512

type serviceTable struct {
	Access *ServiceAccess
}

// NewServiceTable builds the table and QR service.
func NewServiceTable(access *ServiceAccess) ServiceTableMethods {
	return &serviceTable{Access: access}
}

// qrURL builds the URL encoded in a table's QR code.
//
// Delegates to the shared helper so this and the onboarding response cannot disagree about
// what a table's URL is. The base comes from configuration and is validated at startup,
// because getting it wrong prints a floor's worth of stickers pointing at the wrong host -- a
// mistake that is only discovered by a diner who cannot order.
func (s *serviceTable) qrURL(qrToken string) string {
	return tableQRURL(s.Access.Cfg.App.DinerBaseURL, qrToken)
}

func (s *serviceTable) List(
	ctx context.Context,
	actor *StaffPrincipal,
) (*types.ResponseTableList, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	tables, err := s.Access.Repositories.Table.ListByRestaurant(ctx, actor.RestaurantID, true)
	if err != nil {
		log.Errorf("[List] %+v", err)
		return nil, response.ErrTableFetchFailed
	}

	// One grouped query for every table's live count, not one per table: this list renders the
	// whole floor at once and N+1 here would be N+1 on the busiest screen in the panel.
	liveCounts, err := s.Access.Repositories.Table.CountLiveOrders(ctx, actor.RestaurantID, LiveOrderStatuses())
	if err != nil {
		// The counts are a decoration on the floor view. Losing them must not stop a manager
		// reaching the QR codes.
		log.Warnf("[List] live counts unavailable: %+v", err)
		liveCounts = map[int32]int64{}
	}

	views := make([]types.TableInfo, 0, len(tables))
	for _, table := range tables {
		views = append(views, toTableInfo(table, s.qrURL(table.QRToken), liveCounts[table.ID]))
	}
	return &types.ResponseTableList{Tables: views}, nil
}

func (s *serviceTable) Create(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestCreateTable,
) (*types.TableInfo, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}

	label := strings.TrimSpace(req.Label)
	taken, err := s.Access.Repositories.Table.LabelExists(ctx, actor.RestaurantID, label, 0)
	if err != nil {
		log.Errorf("[Create] label check failed: %+v", err)
		return nil, response.ErrTableCreateFailed
	}
	if taken {
		return nil, response.ErrTableLabelTaken
	}

	table := &models.RestaurantTable{
		UID:          utils.GenerateUID(utils.UIDPrefixTable),
		RestaurantID: actor.RestaurantID,
		Label:        label,
		QRToken:      utils.GenerateQRToken(),
		Seats:        req.Seats,
		Status:       models.EntityStatusActive,
	}

	if err := s.Access.Repositories.Table.Create(ctx, nil, table); err != nil {
		log.Errorf("[Create] insert failed: %+v", err)
		return nil, response.ErrTableCreateFailed
	}

	log.Infof("[Create] table %s (%q) created by %s", table.UID, table.Label, actor.StaffUID)

	info := toTableInfo(table, s.qrURL(table.QRToken), 0)
	return &info, nil
}

// BulkCreate adds a numbered range of tables in one call, so onboarding a thirty-table
// restaurant is one form rather than thirty.
func (s *serviceTable) BulkCreate(
	ctx context.Context,
	actor *StaffPrincipal,
	req *types.RequestBulkCreateTables,
) (*types.ResponseTableList, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}

	if req.To < req.From {
		return nil, response.ErrValidation.WithMessage("'to' must not be less than 'from'")
	}
	count := req.To - req.From + 1
	if count > maxBulkTables {
		return nil, response.ErrValidation.WithMessage(
			fmt.Sprintf("at most %d tables can be created at once", maxBulkTables))
	}

	prefix := strings.TrimSpace(req.Prefix)

	// Every label is checked before anything is inserted. A partial floor -- tables 1 to 7
	// created and 8 onward rejected -- would leave the operator guessing what to retry, so the
	// whole batch is validated first and the error names the clash.
	labels := make([]string, 0, count)
	for n := req.From; n <= req.To; n++ {
		label := fmt.Sprintf("%s%d", prefix, n)
		taken, err := s.Access.Repositories.Table.LabelExists(ctx, actor.RestaurantID, label, 0)
		if err != nil {
			log.Errorf("[BulkCreate] label check failed: %+v", err)
			return nil, response.ErrTableCreateFailed
		}
		if taken {
			return nil, response.ErrTableLabelTaken.WithMessage(
				fmt.Sprintf("table %q already exists -- no tables were created", label))
		}
		labels = append(labels, label)
	}

	tables := make([]*models.RestaurantTable, 0, len(labels))
	for _, label := range labels {
		tables = append(tables, &models.RestaurantTable{
			UID:          utils.GenerateUID(utils.UIDPrefixTable),
			RestaurantID: actor.RestaurantID,
			Label:        label,
			QRToken:      utils.GenerateQRToken(),
			Seats:        req.Seats,
			Status:       models.EntityStatusActive,
		})
	}

	if err := s.Access.Repositories.Table.CreateBatch(ctx, nil, tables); err != nil {
		log.Errorf("[BulkCreate] batch insert failed: %+v", err)
		return nil, response.ErrTableCreateFailed
	}

	log.Infof("[BulkCreate] %d tables created by %s", len(tables), actor.StaffUID)

	views := make([]types.TableInfo, 0, len(tables))
	for _, table := range tables {
		views = append(views, toTableInfo(table, s.qrURL(table.QRToken), 0))
	}
	return &types.ResponseTableList{Tables: views}, nil
}

func (s *serviceTable) Update(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
	req *types.RequestUpdateTable,
) (*types.TableInfo, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}

	table, appErr := s.loadTable(ctx, actor.RestaurantID, uid)
	if appErr != nil {
		return nil, appErr
	}

	fields := map[string]any{}
	if req.Label != nil {
		label := strings.TrimSpace(*req.Label)
		taken, err := s.Access.Repositories.Table.LabelExists(ctx, actor.RestaurantID, label, table.ID)
		if err != nil {
			log.Errorf("[Update] label check failed: %+v", err)
			return nil, response.ErrTableUpdateFailed
		}
		if taken {
			return nil, response.ErrTableLabelTaken
		}
		fields["label"] = label
	}
	if req.Seats != nil {
		fields["seats"] = *req.Seats
	}

	if req.Status != nil {
		target := models.EntityStatus(*req.Status)
		// Taking a table out of service while the kitchen is still cooking for it would orphan
		// the order and leave the diner watching a tracking screen nobody is acting on.
		if target != models.EntityStatusActive {
			counts, err := s.Access.Repositories.Table.CountLiveOrders(
				ctx, actor.RestaurantID, LiveOrderStatuses())
			if err != nil {
				log.Errorf("[Update] live count failed: %+v", err)
				return nil, response.ErrTableUpdateFailed
			}
			if counts[table.ID] > 0 {
				return nil, response.ErrTableHasLiveOrders
			}
		}
		fields["status"] = target
	}

	if len(fields) == 0 {
		info := toTableInfo(table, s.qrURL(table.QRToken), 0)
		return &info, nil
	}

	updated, err := s.Access.Repositories.Table.UpdateFields(ctx, table.ID, fields)
	if err != nil {
		log.Errorf("[Update] update failed: %+v", err)
		return nil, response.ErrTableUpdateFailed
	}

	info := toTableInfo(updated, s.qrURL(updated.QRToken), 0)
	return &info, nil
}

// GetQR renders a table's printable QR code.
func (s *serviceTable) GetQR(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
	size int,
) (*types.ResponseTableQR, *response.ApplicationError) {
	table, appErr := s.loadTable(ctx, actor.RestaurantID, uid)
	if appErr != nil {
		return nil, appErr
	}
	return s.renderTableQR(ctx, table, size)
}

// RotateQR issues a fresh token for a table.
//
// The recovery path for a QR that leaked -- photographed and posted online, or printed on a
// card that walked off. Rotating invalidates the printed sticker, which is destructive to a
// physical object, so the admin UI warns before calling this (DECISIONS.md D4).
func (s *serviceTable) RotateQR(
	ctx context.Context,
	actor *StaffPrincipal,
	uid string,
) (*types.ResponseTableQR, *response.ApplicationError) {
	log := s.Access.Logger.With(ctx)

	if !actor.Role.CanManageMenu() {
		return nil, response.ErrInsufficientRole
	}

	table, appErr := s.loadTable(ctx, actor.RestaurantID, uid)
	if appErr != nil {
		return nil, appErr
	}

	updated, err := s.Access.Repositories.Table.UpdateFields(ctx, table.ID, map[string]any{
		"qr_token": utils.GenerateQRToken(),
	})
	if err != nil {
		log.Errorf("[RotateQR] update failed for %s: %+v", uid, err)
		return nil, response.ErrTableUpdateFailed
	}

	// Logged at Info because it invalidates physical signage: if a restaurant reports that a
	// table's QR stopped working, this line is the answer.
	log.Infof("[RotateQR] table %s (%q) token rotated by %s -- the printed QR is now invalid",
		updated.UID, updated.Label, actor.StaffUID)

	return s.renderTableQR(ctx, updated, defaultQRSize)
}

func (s *serviceTable) renderTableQR(
	ctx context.Context,
	table *models.RestaurantTable,
	size int,
) (*types.ResponseTableQR, *response.ApplicationError) {
	url := s.qrURL(table.QRToken)

	if size <= 0 {
		size = defaultQRSize
	}

	png, err := payments.RenderQRPNG(url, size)
	if err != nil {
		// Unlike a payment QR, this one is the entire point of the request -- there is no
		// fallback for a staff member trying to print table cards.
		s.Access.Logger.With(ctx).Errorf("[renderTableQR] %s: %+v", table.UID, err)
		return nil, response.ErrQRRenderFailed
	}

	return &types.ResponseTableQR{
		TableUID:  table.UID,
		Label:     table.Label,
		QRURL:     url,
		PNGBase64: png,
	}, nil
}

func (s *serviceTable) loadTable(
	ctx context.Context,
	restaurantID int32,
	uid string,
) (*models.RestaurantTable, *response.ApplicationError) {
	table, err := s.Access.Repositories.Table.GetByUID(ctx, restaurantID, uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, response.ErrTableNotFound
		}
		s.Access.Logger.With(ctx).Errorf("[loadTable] %s: %+v", uid, err)
		return nil, response.ErrTableFetchFailed
	}
	return table, nil
}
