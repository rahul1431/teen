#!/usr/bin/env bash
# Migration runner with tracking.
# Applies only migrations not yet recorded in schema_migrations table.
# Safe to run multiple times — idempotent.
#
# Usage: bash /opt/teen/infra/db/migrate.sh

set -e
BASE=/opt/teen

echo "==> Ensuring schema_migrations table exists..."
docker exec -i teen_postgres psql -U teen -d teen_db << 'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

echo "==> Applying pending migrations..."
APPLIED=0
SKIPPED=0

for mig in "$BASE"/infra/db/migrations/*.sql; do
  name=$(basename "$mig")

  # Check if already applied
  IS_APPLIED=$(docker exec teen_postgres psql -U teen -d teen_db -t -c \
    "SELECT COUNT(*) FROM schema_migrations WHERE filename = '$name';" 2>/dev/null | tr -d ' ')

  if [[ "$IS_APPLIED" == "1" ]]; then
    echo "  SKIP $name (already applied)"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  echo "  APPLY $name ..."
  if docker exec -i teen_postgres psql -U teen -d teen_db < "$mig"; then
    # Record as applied
    docker exec teen_postgres psql -U teen -d teen_db -c \
      "INSERT INTO schema_migrations (filename) VALUES ('$name') ON CONFLICT DO NOTHING;" > /dev/null
    echo "  OK    $name"
    APPLIED=$((APPLIED+1))
  else
    echo "  FAIL  $name — aborting"
    exit 1
  fi
done

echo ""
echo "==> Done. Applied: ${APPLIED}, Skipped (already done): ${SKIPPED}"
