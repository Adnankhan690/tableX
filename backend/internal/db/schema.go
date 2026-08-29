package db

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"gorm.io/gorm"

	"tablex/internal/models"
)

// How long the schema check may take, and how often it may be retried after failing.
//
// Both exist because the first version of this check had neither, and it took production down.
// It called GORM's Migrator().ColumnTypes() once PER MODEL -- fifteen information_schema
// triple-joins -- on the CALLER'S request context. Against a remote database those outran the
// platform's health-probe timeout; the probe cancelled the context; the check errored before it
// could cache anything; and the next probe started the whole thing again. A permanent loop of
// fifteen expensive queries every few seconds, on the connection pool every other request needed.
//
// The symptom in the logs was `[Ready] schema check failed: read columns of order_item: context
// canceled`, repeating forever.
const (
	schemaCheckTimeout = 4 * time.Second
	schemaRetryAfter   = 60 * time.Second
)

// schemaCheck caches the verdict. A mutex rather than atomics because three pieces of state have
// to move together.
var schemaCheck struct {
	mu       sync.Mutex
	verified bool
	lastTry  time.Time
	gaps     []string
}

// SchemaGaps reports the tables and columns this binary expects and this database does not have.
//
// WHY THIS EXISTS. A binary deployed ahead of its migrations starts happily, answers a ping, is
// routed traffic, and then fails in one of two ways depending on what is missing:
//
//   - A MISSING TABLE is loud. A preload queries a relation that is not there and the request 500s.
//     That is how a missing `order_item_review` reached diners as a broken order screen.
//   - A MISSING COLUMN IS SILENT, AND WORSE. GORM issues `SELECT *`, so the query succeeds and the
//     field is left at its zero value. Had `restaurant.accepting_orders` been missing on its own,
//     every restaurant would have read as CLOSED and refused every order, with nothing in the logs.
//
// THREE RULES, each learned from the incident above:
//
//  1. ONE QUERY, not one per table. information_schema is not cheap on a remote database.
//  2. ITS OWN CONTEXT. A cancelled health probe must not abort the check, or it never finishes,
//     never caches, and every subsequent probe pays for it again.
//  3. FAIL OPEN. An error returns no gaps. A check that cannot answer must never be able to take a
//     healthy service out of rotation -- that is a strictly worse outage than the one it prevents,
//     because it happens when nothing is actually wrong.
//
// Checked against the live schema rather than `schema_migration`, so it is correct however the
// migration was applied -- cmd/migrate, psql, or by hand. (An earlier attempt compared against that
// ledger and reported a perfectly healthy development database as entirely unmigrated, because
// `make migrate` applies the SQL with psql and never writes it.)
//
// Postgres only: the unit tests run on SQLite against a schema the harness builds.
func (s *Store) SchemaGaps(ctx context.Context) ([]string, error) {
	if !s.IsPostgres() {
		return nil, nil
	}

	schemaCheck.mu.Lock()
	defer schemaCheck.mu.Unlock()

	// Verified once is verified for the life of the process: a schema cannot go backwards without
	// a deploy, and a deploy is a new process.
	if schemaCheck.verified {
		return nil, nil
	}
	// Looked recently and it was not clean. Return the previous answer rather than re-running --
	// this is what stops a failing check becoming a query loop.
	if !schemaCheck.lastTry.IsZero() && time.Since(schemaCheck.lastTry) < schemaRetryAfter {
		return schemaCheck.gaps, nil
	}
	schemaCheck.lastTry = time.Now()

	// Detached from the caller. A probe that gives up must not leave this half-finished.
	checkCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), schemaCheckTimeout)
	defer cancel()

	actual, err := s.liveColumns(checkCtx)
	if err != nil {
		schemaCheck.gaps = nil
		return nil, err
	}

	gaps := make([]string, 0)
	for _, model := range models.All() {
		stmt := &gorm.Statement{DB: s.DB}
		if err := stmt.Parse(model); err != nil {
			return nil, fmt.Errorf("parse model: %w", err)
		}

		columns, ok := actual[stmt.Schema.Table]
		if !ok {
			gaps = append(gaps, stmt.Schema.Table+" (missing table)")
			continue
		}
		for _, field := range stmt.Schema.Fields {
			// Associations and `gorm:"-"` fields carry no column and are not schema.
			if field.DBName == "" {
				continue
			}
			if _, present := columns[field.DBName]; !present {
				gaps = append(gaps, stmt.Schema.Table+"."+field.DBName)
			}
		}
	}

	sort.Strings(gaps)
	schemaCheck.gaps = gaps
	if len(gaps) == 0 {
		schemaCheck.verified = true
		return nil, nil
	}
	return gaps, nil
}

// columnRow receives the single catalogue read.
type columnRow struct {
	TableName  string
	ColumnName string
}

// liveColumns reads every column in the current schema in ONE query.
//
// information_schema.columns directly, rather than through the migrator: the migrator's per-table
// helper joins table_constraints and constraint_column_usage to work out keys, which is far more
// work than "does this column exist" needs and is what made the first version unusable.
func (s *Store) liveColumns(ctx context.Context) (map[string]map[string]struct{}, error) {
	var rows []columnRow
	if err := s.DB.WithContext(ctx).Raw(
		`SELECT table_name, column_name
		   FROM information_schema.columns
		  WHERE table_schema = CURRENT_SCHEMA()`,
	).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("read schema catalogue: %w", err)
	}

	byTable := make(map[string]map[string]struct{})
	for _, row := range rows {
		if byTable[row.TableName] == nil {
			byTable[row.TableName] = make(map[string]struct{})
		}
		byTable[row.TableName][row.ColumnName] = struct{}{}
	}
	return byTable, nil
}

// SummariseGaps renders gaps for a log line, bounded so an empty database does not print a page.
func SummariseGaps(gaps []string) string {
	const max = 12
	if len(gaps) <= max {
		return fmt.Sprintf("%v", gaps)
	}
	return fmt.Sprintf("%v (and %d more)", gaps[:max], len(gaps)-max)
}
