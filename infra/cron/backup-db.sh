#!/bin/bash

# infra/cron/backup-db.sh
# Daily PostgreSQL backup with compression and rotation
# Designed to run daily at 2 AM UTC via cron
# Schedule: 0 2 * * * /home/admin/infra/cron/backup-db.sh >> /var/log/backup-db.log 2>&1

set -e

# Configuration
BACKUP_DIR="/home/admin/backups/postgres"
RETENTION_DAYS=30
LOG_FILE="/var/log/backup-db.log"
DB_USER="teen"
DB_NAME="teen_db"
DB_CONTAINER="teen_postgres"
TIMESTAMP=$(date +'%Y-%m-%d-%H-%M')
BACKUP_FILE="$BACKUP_DIR/backup-$TIMESTAMP.sql.gz"

# Logging function
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Error handling
error_exit() {
  log "ERROR: $1"
  # Send alert (optional - can be wired to Slack/email later)
  exit 1
}

log "=========================================="
log "Starting daily PostgreSQL backup (teen_db)"
log "=========================================="

# Ensure backup directory exists
if [ ! -d "$BACKUP_DIR" ]; then
  log "Creating backup directory: $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR" || error_exit "Failed to create backup directory"
  chmod 700 "$BACKUP_DIR"
fi

# Verify database container is running
if ! docker ps | grep -q "$DB_CONTAINER"; then
  error_exit "Database container '$DB_CONTAINER' is not running"
fi

# Perform backup using pg_dump via Docker
log "Dumping database: $DB_NAME..."
if docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" 2>>"$LOG_FILE" \
  | gzip > "$BACKUP_FILE.tmp"; then
  mv "$BACKUP_FILE.tmp" "$BACKUP_FILE"
  BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "Backup successful: $BACKUP_FILE ($BACKUP_SIZE)"
else
  rm -f "$BACKUP_FILE.tmp"
  error_exit "pg_dump failed - see log for details"
fi

# Verify backup file size (should not be empty)
if [ ! -s "$BACKUP_FILE" ]; then
  rm -f "$BACKUP_FILE"
  error_exit "Backup file is empty - backup failed"
fi

# Rotation: Delete backups older than RETENTION_DAYS
log "Rotating backups (keeping last $RETENTION_DAYS days)..."
DELETED_COUNT=0
while IFS= read -r old_backup; do
  log "  Deleting old backup: $(basename "$old_backup")"
  rm -f "$old_backup"
  ((DELETED_COUNT++))
done < <(find "$BACKUP_DIR" -name "backup-*.sql.gz" -mtime +$RETENTION_DAYS)

if [ "$DELETED_COUNT" -gt 0 ]; then
  log "Deleted $DELETED_COUNT old backups"
else
  log "No old backups to delete"
fi

# List current backups
log "Current backups:"
ls -lh "$BACKUP_DIR"/backup-*.sql.gz | tail -5 | sed 's/^/  /'

log "Backup complete. Available at: $BACKUP_FILE"
log "=========================================="

exit 0
