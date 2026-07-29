#!/bin/bash
# Applies any infra/db/migrations/*.sql not yet recorded in schema_migrations,
# in filename order, against the given database via the teen_postgres Docker
# container. Idempotent — safe to run on every deploy; only new files do
# anything. Stops (non-zero exit) on the first migration that fails, so a
# broken migration blocks the deploy instead of restarting services against
# a half-migrated schema.
#
# Usage: apply-migrations.sh <db_name>
set -euo pipefail

DB_NAME="${1:?Usage: apply-migrations.sh <db_name>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
PSQL_EXEC=(docker exec -i teen_postgres psql -U teen -d "$DB_NAME" -v ON_ERROR_STOP=1)

"${PSQL_EXEC[@]}" -q -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"

applied_count=0
total_count=0

for f in "$MIGRATIONS_DIR"/*.sql; do
  total_count=$((total_count + 1))
  name="$(basename "$f")"
  already="$("${PSQL_EXEC[@]}" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$name'")"
  if [ "$already" = "1" ]; then
    continue
  fi

  echo "Applying $name..."
  if "${PSQL_EXEC[@]}" -q < "$f"; then
    "${PSQL_EXEC[@]}" -q -c "INSERT INTO schema_migrations (filename) VALUES ('$name')"
    applied_count=$((applied_count + 1))
    echo "Applied $name"
  else
    echo "FAILED applying $name — stopping migration run" >&2
    exit 1
  fi
done

echo "Migrations complete for $DB_NAME: $applied_count applied this run, $total_count total tracked"
