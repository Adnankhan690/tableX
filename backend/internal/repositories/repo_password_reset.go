package repositories

import (
	"context"
	"time"

	"gorm.io/gorm"

	"tablex/internal/models"
)

type repositoryPasswordReset struct {
	*RepositoryAccess
}

func NewRepositoryPasswordReset(access *RepositoryAccess) RepositoryPasswordResetMethods {
	return &repositoryPasswordReset{RepositoryAccess: access}
}

func (r *repositoryPasswordReset) CreateCode(ctx context.Context, resetCode *models.PasswordResetCode) error {
	err := r.conn(nil).WithContext(ctx).Create(resetCode).Error
	if err != nil {
		r.Logger.With(ctx).Errorf("[CreateCode] email=%q: %v", resetCode.Email, err)
		return err
	}
	return nil
}

func (r *repositoryPasswordReset) GetActiveCode(ctx context.Context, email string, code string) (*models.PasswordResetCode, error) {
	var resetCode models.PasswordResetCode
	err := r.conn(nil).WithContext(ctx).
		Where("email = ? AND code = ? AND used = FALSE AND expires_at > ?", email, code, time.Now().UTC()).
		First(&resetCode).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		r.Logger.With(ctx).Errorf("[GetActiveCode] email=%q code=%s: %v", email, code, err)
		return nil, err
	}
	return &resetCode, nil
}

func (r *repositoryPasswordReset) MarkCodeUsed(ctx context.Context, id int32) error {
	err := r.conn(nil).WithContext(ctx).
		Model(&models.PasswordResetCode{}).
		Where("id = ?", id).
		Update("used", true).Error
	if err != nil {
		r.Logger.With(ctx).Errorf("[MarkCodeUsed] id=%d: %v", id, err)
		return err
	}
	return nil
}

func (r *repositoryPasswordReset) GetLastActiveCode(ctx context.Context, email string) (*models.PasswordResetCode, error) {
	var resetCode models.PasswordResetCode
	err := r.conn(nil).WithContext(ctx).
		Where("email = ? AND used = FALSE AND expires_at > ?", email, time.Now().UTC()).
		Order("created_at DESC").
		First(&resetCode).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		r.Logger.With(ctx).Errorf("[GetLastActiveCode] email=%q: %v", email, err)
		return nil, err
	}
	return &resetCode, nil
}
