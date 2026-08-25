// Package migrations embeds the SQL schema files so a built binary carries its own
// migrations.
//
// The alternative -- shipping an image and fetching the SQL from the repository at deploy
// time -- lets a container be pointed at a database whose schema it does not match, which
// is how a rollout half-applies. Embedding makes the binary and the schema one artifact.
package migrations

import "embed"

// FS holds every file under postgres/, both directions. Only the .up.sql files are applied
// by cmd/migrate; the .down.sql files are embedded too so a rollback does not need the
// working tree, and CI already proves they run (see .github/workflows/ci.yml).
//
//go:embed postgres/*.sql
var FS embed.FS
