// Package db opens the database and owns the transaction helper.
//
// Postgres is the only production driver. SQLite exists so the test suite runs with no
// container and no CGO, which is what keeps `go test ./...` a single command in CI.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"tablex/internal/config"
)

// Store wraps the GORM handle.
//
// A struct rather than a bare *gorm.DB so the transaction helper and any future read
// replica live behind one type that every repository already holds.
type Store struct {
	DB *gorm.DB
}

// Open connects using the configured driver and applies pool settings.
func Open(cfg *config.DatabaseConfig) (*Store, error) {
	gormCfg := &gorm.Config{
		Logger: gormlogger.Default.LogMode(logLevel(cfg.LogQueries)),
		// Timestamps are generated in Go, in UTC, so every row is comparable regardless of
		// which server wrote it. Business dates are converted to the restaurant's timezone
		// at the point of use instead (DECISIONS.md D9).
		NowFunc: func() time.Time { return time.Now().UTC() },
		// The default plural-snake-case naming already matches our migrations, but skipping
		// GORM's default transaction on single writes is a measurable win on the hot path
		// -- placing an order runs its own explicit transaction anyway.
		SkipDefaultTransaction: true,
	}

	var (
		gdb *gorm.DB
		err error
	)

	switch cfg.Driver {
	case "postgres":
		gdb, err = gorm.Open(postgres.Open(cfg.PostgresDSN()), gormCfg)
	case "sqlite":
		name := cfg.Name
		if name == "" {
			name = ":memory:"
		}
		gdb, err = gorm.Open(sqlite.Open(name), gormCfg)
	default:
		return nil, fmt.Errorf("db: unsupported driver %q", cfg.Driver)
	}
	if err != nil {
		return nil, fmt.Errorf("db: open %s: %w", cfg.Driver, err)
	}

	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, fmt.Errorf("db: unwrap sql.DB: %w", err)
	}

	if cfg.MaxOpenConns > 0 {
		sqlDB.SetMaxOpenConns(cfg.MaxOpenConns)
	}
	if cfg.MaxIdleConns > 0 {
		sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)
	}
	if cfg.ConnMaxLifetime > 0 {
		sqlDB.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	}

	return &Store{DB: gdb}, nil
}

// Ping verifies the connection, for the readiness probe.
func (s *Store) Ping(ctx context.Context) error {
	sqlDB, err := s.DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.PingContext(ctx)
}

// Close releases the pool.
func (s *Store) Close() error {
	sqlDB, err := s.DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// IsPostgres reports whether row-level locking is available.
//
// Repositories use this to skip SELECT ... FOR UPDATE under SQLite, which has no such
// syntax. The lock is what serialises concurrent order placement, so the distinction is
// load-bearing rather than cosmetic -- and it is why the concurrency tests run against
// Postgres, not SQLite.
func (s *Store) IsPostgres() bool { return s.DB.Dialector.Name() == "postgres" }

// Transaction runs fn inside a database transaction, rolling back on error or panic.
//
// Every multi-write flow goes through here. Placing an order writes the order, its items,
// a status event, a payment row, and increments the daily counter -- five writes that must
// either all land or none, because a diner charged for an order the kitchen never received
// is the failure this product cannot have (PRD 7).
func (s *Store) Transaction(ctx context.Context, fn func(tx *gorm.DB) error) error {
	return s.DB.WithContext(ctx).Transaction(fn)
}

// WithContext returns a context-bound handle for a single read.
func (s *Store) WithContext(ctx context.Context) *gorm.DB {
	return s.DB.WithContext(ctx)
}

func logLevel(verbose bool) gormlogger.LogLevel {
	if verbose {
		return gormlogger.Info
	}
	// Warn, not Silent: a slow query or a missing index should still surface without
	// logging every statement and its parameters.
	return gormlogger.Warn
}
