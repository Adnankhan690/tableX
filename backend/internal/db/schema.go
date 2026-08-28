package db

import (
	"context"
	"fmt"
	"sort"
	"sync/atomic"

	"gorm.io/gorm"

	"tablex/internal/models"
)

// schemaVerified caches the "this database matches this binary" answer.
//
// Cached because readiness is probed every few seconds and the check costs a query per table, and
// cached ONE WAY ONLY: a process that has seen a complete schema cannot later see an incomplete
// one without a deploy, and a deploy is a new process. Caching the negative would be wrong --
// recovering from it is exactly the case this exists to support, where an operator migrates a
// database this instance is already connected to and the next probe must notice.
var schemaVerified atomic.Bool

// maxReportedGaps bounds the log line. A database with nothing in it produces one gap per column
// across every model, and a thousand-item log line is not read by anyone.
const maxReportedGaps = 12

// SchemaGaps reports the tables and columns this binary expects and this database does not have.
//
// WHY THIS EXISTS. A binary deployed ahead of its migrations starts happily, answers a ping, gets
// routed traffic, and then fails in one of two ways depending on what is missing:
//
//   - A MISSING TABLE is loud. GORM's preload queries a relation that does not exist and the whole
//     request 500s. That is how a missing `order_item_review` reached diners as a broken order
//     screen, and reached whoever deployed it as nothing at all.
//   - A MISSING COLUMN IS SILENT, AND WORSE. GORM issues `SELECT *`, so the query succeeds and the
//     struct field is simply left at its zero value. Had `restaurant.accepting_orders` been missing
//     on its own, every restaurant would have read as CLOSED and quietly refused every order, with
//     nothing in the logs to say why.
//
// Reporting both here turns the whole class into a deploy that never goes live: the platform routes
// on readiness, so an instance whose schema is behind takes no traffic and the previous one keeps
// serving until somebody runs the migration.
//
// Checked against the live schema rather than against `schema_migration`, so it is correct however
// the migration was applied -- by cmd/migrate, by psql, or by hand.
//
// Postgres only. The unit tests run on SQLite against a schema the test harness builds, so there is
// nothing meaningful to compare there.
func (s *Store) SchemaGaps(ctx context.Context) ([]string, error) {
	if schemaVerified.Load() || !s.IsPostgres() {
		return nil, nil
	}

	migrator := s.DB.WithContext(ctx).Migrator()
	gaps := make([]string, 0)

	for _, model := range models.All() {
		stmt := &gorm.Statement{DB: s.DB}
		if err := stmt.Parse(model); err != nil {
			return nil, fmt.Errorf("parse model: %w", err)
		}
		table := stmt.Schema.Table

		if !migrator.HasTable(model) {
			gaps = append(gaps, table+" (missing table)")
			continue
		}

		// One query for the whole table rather than HasColumn per field: fifteen models at twenty
		// fields each would be three hundred round trips on a probe that runs every few seconds.
		columns, err := migrator.ColumnTypes(model)
		if err != nil {
			return nil, fmt.Errorf("read columns of %s: %w", table, err)
		}
		present := make(map[string]struct{}, len(columns))
		for _, c := range columns {
			present[c.Name()] = struct{}{}
		}

		for _, field := range stmt.Schema.Fields {
			// Associations and `gorm:"-"` fields carry no column and are not schema.
			if field.DBName == "" {
				continue
			}
			if _, ok := present[field.DBName]; !ok {
				gaps = append(gaps, table+"."+field.DBName)
			}
		}
	}

	if len(gaps) == 0 {
		schemaVerified.Store(true)
		return nil, nil
	}

	sort.Strings(gaps)
	return gaps, nil
}

// SummariseGaps renders gaps for a log line, bounded so an empty database does not print a page.
func SummariseGaps(gaps []string) string {
	if len(gaps) <= maxReportedGaps {
		return fmt.Sprintf("%v", gaps)
	}
	return fmt.Sprintf("%v (and %d more)", gaps[:maxReportedGaps], len(gaps)-maxReportedGaps)
}
