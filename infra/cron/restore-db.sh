#!/bin/bash

# infra/cron/restore-db.sh
# PostgreSQL database restoration from backup
# Usage: ./restore-db.sh /path/to/backup-2026-07-11-12-00.sql.gz [--force]
#
# WARNING: This will DROP the current database and restore from backup.
# Use --force flag to skip confirmation prompt.

set -e

# Configuration
DB_USER="teen"
DB_NAME="teen_db"
DB_CONTAINER="teen_postgres"
LOG_FILE="/var/log/backup-db.log"

# Logging function
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Error handling
error_exit() {
  log "ERROR: $1"
  exit 1
}

# Check arguments
if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup_file.sql.gz> [--force]"
  echo ""
  echo "Example: $0 /home/admin/backups/postgres/backup-2026-07-11-12-00.sql.gz"
  echo ""
  echo "Available backups:"
  ls -lh /home/admin/backups/postgres/backup-*.sql.gz 2>/dev/null | tail -10 || echo "  (no backups found)"
  exit 1
fi

BACKUP_FILE="$1"
FORCE_FLAG="${2:-}"

# Verify backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
  error_exit "Backup file not found: $BACKUP_FILE"
fi

# Verify it's a gzip file
if ! file "$BACKUP_FILE" | grep -q gzip; then
  error_exit "File doesn't appear to be a gzip archive: $BACKUP_FILE"
fi

log "=========================================="
log "Starting PostgreSQL restore from backup"
log "=========================================="
log "Backup file: $BACKUP_FILE"
log "Database: $DB_NAME"
log "Container: $DB_CONTAINER"

# Confirmation prompt (unless --force is used)
if [ "$FORCE_FLAG" != "--force" ]; then
  echo ""
  echo "WARNING: This will DROP the database '$DB_NAME' and restore from backup."
  echo "This action cannot be undone without another backup."
  echo ""
  read -p "Type 'yes' to confirm restore: " CONFIRM

  if [ "$CONFIRM" != "yes" ]; then
    error_exit "Restore cancelled by user"
  fi
fi

# Verify database container is running
if ! docker ps | grep -q "$DB_CONTAINER"; then
  error_exit "Database container '$DB_CONTAINER' is not running"
fi

log "Stopping all services connected to database..."
# Note: You may want to add: pm2 stop all (optional, depends on your setup)

log "Dropping current database: $DB_NAME..."
if ! docker exec "$DB_CONTAINER" psql -U "$DB_USER" -tc \
  "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  log "Database '$DB_NAME' does not exist, creating it..."
  docker exec "$DB_CONTAINER" psql -U "postgres" -c "CREATE DATABASE $DB_NAME;"
else
  # Terminate connections and drop database
  docker exec "$DB_CONTAINER" psql -U "postgres" <<EOF || error_exit "Failed to drop database"
SELECT pg_terminate_backend(pg_stat_activity.pid)
FROM pg_stat_activity
WHERE pg_stat_activity.datname = '$DB_NAME'
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS $DB_NAME;
CREATE DATABASE $DB_NAME;
EOF
fi

log "Restoring database from backup: $BACKUP_FILE..."
if gunzip -c "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" 2>>"$LOG_FILE"; then
  log "Database restore successful"
else
  error_exit "Restore failed - see log for details"
fi

# Verify restore
log "Verifying restored database..."
TABLE_COUNT=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")

log "Restored database has $TABLE_COUNT tables"

log "=========================================="
log "Restore complete!"
log "Next steps:"
log "  1. Verify data integrity with: docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c '\\dt'"
log "  2. Restart services: pm2 restart all"
log "=========================================="

exit 0
