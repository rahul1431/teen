#!/bin/bash
# One-time bootstrap for a database that already has schema from migrations
# applied by hand (i.e. every environment as of 2026-07-12). Marks migration
# files as already-applied in schema_migrations WITHOUT re-running their SQL,
# up to and including the given filename (inclusive). Anything after that
# point is left pending so the next deploy's apply-migrations.sh actually
# runs it — useful for proving the automated path works on a migration that
# genuinely hasn't shipped to that environment yet.
#
# Usage: baseline-schema-migrations.sh <db_name> <last_applied_filename>
# Example: baseline-schema-migrations.sh teen_db_prod 063_deployment_rollback_tracking.sql
set -euo pipefail

DB_NAME="${1:?Usage: baseline-schema-migrations.sh <db_name> <last_applied_filename>}"
LAST_APPLIED="${2:?Usage: baseline-schema-migrations.sh <db_name> <last_applied_filename>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
PSQL_EXEC=(docker exec -i teen_postgres psql -U teen -d "$DB_NAME" -v ON_ERROR_STOP=1)

if [ ! -f "$MIGRATIONS_DIR/$LAST_APPLIED" ]; then
  echo "No such migration file: $LAST_APPLIED" >&2
  exit 1
fi

"${PSQL_EXEC[@]}" -q -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"

count=0
for f in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$f")"
  "${PSQL_EXEC[@]}" -q -c "INSERT INTO schema_migrations (filename) VALUES ('$name') ON CONFLICT DO NOTHING"
  count=$((count + 1))
  if [ "$name" = "$LAST_APPLIED" ]; then
    break
  fi
done

echo "Baselined $count migration(s) as already-applied for $DB_NAME (through $LAST_APPLIED)"
