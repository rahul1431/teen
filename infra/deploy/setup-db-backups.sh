#!/bin/bash

# infra/deploy/setup-db-backups.sh
# Setup automated daily PostgreSQL backups on VPS
# Run this ONCE on the VPS to configure cron jobs and directories
# Usage: bash infra/deploy/setup-db-backups.sh

set -e

echo "=========================================="
echo "Setting up PostgreSQL daily backups"
echo "=========================================="

# Ensure running as root
if [ "$EUID" -ne 0 ]; then
  echo "ERROR: This script must be run as root"
  exit 1
fi

BASE="/opt/teen"
BACKUP_DIR="/home/admin/backups/postgres"
CRON_DIR="/home/admin/infra/cron"

echo ""
echo "Step 1: Creating backup directory..."
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
echo "  Created: $BACKUP_DIR"

echo ""
echo "Step 2: Creating cron directory..."
mkdir -p "$CRON_DIR"
chmod 755 "$CRON_DIR"
echo "  Created: $CRON_DIR"

echo ""
echo "Step 3: Copying backup scripts..."
if [ ! -f "$BASE/infra/cron/backup-db.sh" ]; then
  echo "ERROR: backup-db.sh not found in $BASE/infra/cron/"
  exit 1
fi

cp "$BASE/infra/cron/backup-db.sh" "$CRON_DIR/backup-db.sh"
chmod 755 "$CRON_DIR/backup-db.sh"
echo "  Copied: backup-db.sh"

cp "$BASE/infra/cron/restore-db.sh" "$CRON_DIR/restore-db.sh"
chmod 755 "$CRON_DIR/restore-db.sh"
echo "  Copied: restore-db.sh"

echo ""
echo "Step 4: Setting up cron job..."

CRON_JOB="0 2 * * * /home/admin/infra/cron/backup-db.sh >> /var/log/backup-db.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "backup-db.sh"; then
  echo "  Cron job already exists, skipping..."
else
  # Add cron job (append to existing crontab)
  (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab - || exit 1
  echo "  Added cron job:"
  echo "  $CRON_JOB"
fi

echo ""
echo "Step 5: Setting up log rotation..."

# Create logrotate config for backup logs
LOG_ROTATE_CONFIG="/etc/logrotate.d/backup-db"
cat > "$LOG_ROTATE_CONFIG" <<'EOF'
/var/log/backup-db.log {
  daily
  rotate 30
  compress
  delaycompress
  missingok
  notifempty
  create 0600 root root
}
EOF
chmod 644 "$LOG_ROTATE_CONFIG"
echo "  Created logrotate config: $LOG_ROTATE_CONFIG"

echo ""
echo "Step 6: Testing backup script..."
if /home/admin/infra/cron/backup-db.sh; then
  echo "  Backup test successful!"
  LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/backup-*.sql.gz 2>/dev/null | head -1)
  if [ -n "$LATEST_BACKUP" ]; then
    SIZE=$(du -h "$LATEST_BACKUP" | cut -f1)
    echo "  Latest backup: $(basename "$LATEST_BACKUP") ($SIZE)"
  fi
else
  echo "  WARNING: Backup test failed - check logs at /var/log/backup-db.log"
  exit 1
fi

echo ""
echo "=========================================="
echo "PostgreSQL backup setup complete!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  Backup directory: $BACKUP_DIR"
echo "  Backup script: $CRON_DIR/backup-db.sh"
echo "  Restore script: $CRON_DIR/restore-db.sh"
echo "  Cron schedule: Daily at 2 AM UTC"
echo "  Retention: Last 30 days"
echo "  Logs: /var/log/backup-db.log"
echo ""
echo "Verification:"
echo "  Check latest backup: ls -lh $BACKUP_DIR/backup-*.sql.gz | tail -3"
echo "  View cron job: crontab -l | grep backup"
echo "  View backup logs: tail -50 /var/log/backup-db.log"
echo "  Restore from backup: /home/admin/infra/cron/restore-db.sh <backup-file>"
echo ""
