// Command migrate applies the embedded Postgres schema migrations.
//
// It is a separate binary from the server on purpose. Migrating on server startup means
// every replica races to apply the same DDL, and a failed migration then presents as a
// crash-looping service rather than a failed deploy step. Render runs this as the
// pre-deploy command, so a migration that fails stops the rollout with the old version
// still serving.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"sort"
	"strings"
	"time"

	"tablex/internal/config"
	"tablex/internal/db"
	"tablex/migrations"
)

// advisoryLockKey is an arbitrary constant, shared by every instance of this command. Two
// deploys overlapping -- a retry racing the original, typically -- would otherwise both see
// the same pending list and both try to apply it.
const advisoryLockKey int64 = 8_531_204_771

// lockTimeout bounds the wait for that lock. A deploy blocked behind another deploy should
// fail visibly rather than hang until the platform kills it with no explanation.
const lockTimeout = 2 * time.Minute

func main() {
	configPath := flag.String("config", "config/production.yml", "path to the configuration file")
	statusOnly := flag.Bool("status", false, "report applied and pending migrations, then exit without applying")
	flag.Parse()

	if err := run(*configPath, *statusOnly); err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
}

func run(configPath string, statusOnly bool) error {
	// The same loader the server uses, so the migration step fails on a bad configuration
	// before the new version is rolled out rather than after.
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}
	if cfg.Database.Driver != "postgres" {
		return fmt.Errorf("driver is %q; migrations are Postgres-only", cfg.Database.Driver)
	}

	store, err := db.Open(&cfg.Database)
	if err != nil {
		return err
	}
	sqlDB, err := store.DB.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	files, err := upMigrations()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), lockTimeout)
	defer cancel()

	// A single connection for the whole run: a session-level advisory lock is held by the
	// connection that took it, so returning it to the pool mid-run would release it.
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire connection: %w", err)
	}
	defer conn.Close()

	if err := ensureVersionTable(ctx, conn); err != nil {
		return err
	}

	if statusOnly {
		return reportStatus(ctx, conn, files)
	}

	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", advisoryLockKey); err != nil {
		return fmt.Errorf("acquire advisory lock: %w", err)
	}
	defer func() {
		// Best effort: the lock is session-scoped and the connection is about to close,
		// which releases it anyway. Unlocking explicitly just makes the intent legible.
		_, _ = conn.ExecContext(context.Background(), "SELECT pg_advisory_unlock($1)", advisoryLockKey)
	}()

	applied, err := appliedVersions(ctx, conn)
	if err != nil {
		return err
	}

	pending := 0
	for _, name := range files {
		version := versionOf(name)
		if _, done := applied[version]; done {
			continue
		}
		if err := apply(ctx, conn, name, version); err != nil {
			return err
		}
		fmt.Printf("applied %s\n", version)
		pending++
	}

	if pending == 0 {
		fmt.Println("schema is up to date; nothing to apply")
	} else {
		fmt.Printf("applied %d migration(s)\n", pending)
	}
	return nil
}

// upMigrations lists the forward migrations in the order they must run. The filenames are
// zero-padded and numbered, so a lexical sort is the intended order.
func upMigrations() ([]string, error) {
	entries, err := fs.Glob(migrations.FS, "postgres/*.up.sql")
	if err != nil {
		return nil, fmt.Errorf("list migrations: %w", err)
	}
	if len(entries) == 0 {
		return nil, errors.New("no migrations were embedded; this binary cannot migrate anything")
	}
	sort.Strings(entries)
	return entries, nil
}

// versionOf turns postgres/007_create_orders.up.sql into 007_create_orders.
func versionOf(path string) string {
	base := strings.TrimPrefix(path, "postgres/")
	return strings.TrimSuffix(base, ".up.sql")
}

func ensureVersionTable(ctx context.Context, conn *sql.Conn) error {
	const stmt = `
CREATE TABLE IF NOT EXISTS schema_migration (
    version    VARCHAR(128) PRIMARY KEY,
    applied_at TIMESTAMPTZ  NOT NULL DEFAULT now()
)`
	if _, err := conn.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("create schema_migration: %w", err)
	}
	return nil
}

func appliedVersions(ctx context.Context, conn *sql.Conn) (map[string]struct{}, error) {
	rows, err := conn.QueryContext(ctx, "SELECT version FROM schema_migration")
	if err != nil {
		return nil, fmt.Errorf("read schema_migration: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]struct{})
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, fmt.Errorf("scan schema_migration: %w", err)
		}
		applied[v] = struct{}{}
	}
	return applied, rows.Err()
}

// apply runs one migration and records it in the same transaction. Postgres has
// transactional DDL, so a migration that fails half way leaves neither the tables nor the
// version row behind -- rerunning the deploy retries it cleanly.
func apply(ctx context.Context, conn *sql.Conn, path, version string) error {
	body, err := migrations.FS.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin %s: %w", version, err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, string(body)); err != nil {
		return fmt.Errorf("apply %s: %w", version, err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migration (version) VALUES ($1)", version); err != nil {
		return fmt.Errorf("record %s: %w", version, err)
	}
	return tx.Commit()
}

func reportStatus(ctx context.Context, conn *sql.Conn, files []string) error {
	applied, err := appliedVersions(ctx, conn)
	if err != nil {
		return err
	}
	for _, name := range files {
		version := versionOf(name)
		mark := "pending"
		if _, done := applied[version]; done {
			mark = "applied"
		}
		fmt.Printf("%-8s %s\n", mark, version)
	}
	return nil
}
