# PostgreSQL Backup & Restore Guide

## Overview

The Teen Patti production database (`teen_db`) is automatically backed up daily at **2 AM UTC** to `/home/admin/backups/postgres/`. Each backup is compressed with gzip and kept for 30 days.

**Status**: ✅ Configured and tested as of 2026-07-11

---

## Backup Configuration

### Location
- **Backup directory**: `/home/admin/backups/postgres/`
- **Backup script**: `/home/admin/infra/cron/backup-db.sh`
- **Restore script**: `/home/admin/infra/cron/restore-db.sh`
- **Logs**: `/var/log/backup-db.log`

### Schedule
- **Cron job**: `0 2 * * * /home/admin/infra/cron/backup-db.sh >> /var/log/backup-db.log 2>&1`
- **Frequency**: Daily at 2 AM UTC
- **Retention**: Last 30 days (older backups auto-deleted)

### Backup Details
- **Database**: `teen_db` (user: `teen`)
- **Container**: `teen_postgres` (Docker)
- **Compression**: gzip (.sql.gz)
- **Typical size**: ~952 KB compressed (~50 MB uncompressed)

---

## Backup Commands

### List Available Backups
```bash
# SSH into VPS
ssh root@64.204.130.181

# List all backups
ls -lh /home/admin/backups/postgres/backup-*.sql.gz

# Show latest 5 backups
ls -lh /home/admin/backups/postgres/backup-*.sql.gz | tail -5
```

### View Backup Logs
```bash
# Last 50 lines
tail -50 /var/log/backup-db.log

# Live tail
tail -f /var/log/backup-db.log

# Full log
cat /var/log/backup-db.log
```

### Verify Cron Job
```bash
# Check if cron job is configured
crontab -l | grep backup-db

# Expected output:
# 0 2 * * * /home/admin/infra/cron/backup-db.sh >> /var/log/backup-db.log 2>&1
```

### Run Manual Backup
```bash
# Run backup immediately (useful for testing)
/home/admin/infra/cron/backup-db.sh

# Expected output:
# [2026-07-11 16:48:53] Starting daily PostgreSQL backup (teen_db)...
# [2026-07-11 16:48:54] Backup successful: /home/admin/backups/postgres/backup-2026-07-11-16-48.sql.gz (952K)
```

### Verify Backup Integrity
```bash
LATEST_BACKUP=$(ls -t /home/admin/backups/postgres/backup-*.sql.gz | head -1)

# Check if file can be decompressed
gunzip -t "$LATEST_BACKUP" && echo "Backup OK" || echo "Backup CORRUPTED"

# Check file size
du -h "$LATEST_BACKUP"

# Check SQL content (first 20 lines)
gunzip -c "$LATEST_BACKUP" | head -20
```

---

## Restore from Backup

### Warning ⚠️
**Restoration will DROP the entire database and replace it with backup data.**
This action cannot be undone except by having another backup.

### Usage
```bash
# Syntax
/home/admin/infra/cron/restore-db.sh <backup_file> [--force]

# Example (with confirmation prompt)
/home/admin/infra/cron/restore-db.sh /home/admin/backups/postgres/backup-2026-07-11-16-48.sql.gz

# Example (skip confirmation)
/home/admin/infra/cron/restore-db.sh /home/admin/backups/postgres/backup-2026-07-11-16-48.sql.gz --force
```

### Step-by-Step Restore Process

1. **Stop All Services** (optional but recommended)
   ```bash
   pm2 stop all
   ```

2. **List Available Backups**
   ```bash
   ls -lh /home/admin/backups/postgres/backup-*.sql.gz
   ```

3. **Restore from Backup**
   ```bash
   /home/admin/infra/cron/restore-db.sh /home/admin/backups/postgres/backup-2026-07-11-12-00.sql.gz
   
   # When prompted, type "yes" to confirm
   ```

4. **Verify Restoration**
   ```bash
   # Check that database was restored
   docker exec teen_postgres psql -U teen -d teen_db -c "\dt"
   
   # Check table counts
   docker exec teen_postgres psql -U teen -d teen_db -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
   ```

5. **Restart Services**
   ```bash
   pm2 restart all
   ```

### Emergency Restore (Quick Steps)
For critical failures, if you need to restore quickly:

```bash
# SSH to VPS
ssh root@64.204.130.181

# Get latest backup
LATEST=$(ls -t /home/admin/backups/postgres/backup-*.sql.gz | head -1)

# Restore with force flag (skips confirmation)
/home/admin/infra/cron/restore-db.sh "$LATEST" --force

# Wait for restore to complete...
# Then restart services
pm2 restart all
```

---

## Restore Advanced (Manual SQL)

If the restore script fails, you can restore manually:

```bash
# SSH to VPS
ssh root@64.204.130.181

# Decompress backup to stdout and pipe to psql
gunzip -c /home/admin/backups/postgres/backup-2026-07-11-12-00.sql.gz | \
  docker exec -i teen_postgres psql -U teen -d teen_db

# Or save to a file first (requires space)
gunzip -c /home/admin/backups/postgres/backup-2026-07-11-12-00.sql.gz > /tmp/restore.sql
docker exec -i teen_postgres psql -U teen -d teen_db < /tmp/restore.sql
rm /tmp/restore.sql
```

---

## Backup Infrastructure Details

### Database Container
```bash
# Check container status
docker ps | grep teen_postgres

# Access database directly
docker exec -it teen_postgres psql -U teen -d teen_db

# Backup via Docker
docker exec teen_postgres pg_dump -U teen -d teen_db | gzip > backup.sql.gz

# Restore via Docker
gunzip -c backup.sql.gz | docker exec -i teen_postgres psql -U teen -d teen_db
```

### Log Rotation
Backup logs are automatically rotated daily via logrotate:
- **Config**: `/etc/logrotate.d/backup-db`
- **Keep**: Last 30 compressed logs
- **Old logs**: Stored as `/var/log/backup-db.log-*.gz`

### Cron Job Management
```bash
# View all cron jobs
crontab -l

# Edit cron (to modify schedule)
crontab -e

# Remove backup cron job (if needed)
crontab -l | grep -v "backup-db.sh" | crontab -
```

---

## Monitoring & Alerts

### Check Latest Backup Time
```bash
# Last backup
ls -lh /home/admin/backups/postgres/backup-*.sql.gz | tail -1 | awk '{print $6, $7, $8, $9}'

# Or check logs
tail -1 /var/log/backup-db.log | grep "Available at"
```

### Monitor Backup Directory Size
```bash
# Total size of all backups
du -sh /home/admin/backups/postgres/

# Individual backup sizes
du -h /home/admin/backups/postgres/backup-*.sql.gz

# If backups are too large (>5GB), consider increasing retention or reducing frequency
# NOTE: Current setup = ~30 days × 1 backup/day × 1MB each = ~30MB max
```

### Verify Backups Are Running

To verify backups are running on schedule:

```bash
# Check if backup ran in last 24 hours
find /home/admin/backups/postgres/ -name "backup-*.sql.gz" -newermt "24 hours ago" 2>/dev/null && \
  echo "Backup ran in last 24 hours" || \
  echo "WARNING: No backup in last 24 hours"

# Check for backup errors
grep ERROR /var/log/backup-db.log && echo "Errors found in logs" || echo "No errors in logs"
```

---

## Troubleshooting

### Backup Fails
```bash
# Check logs
tail -50 /var/log/backup-db.log

# Check if container is running
docker ps | grep teen_postgres

# Check container logs
docker logs teen_postgres

# Check disk space
df -h /home/admin/backups/postgres/

# Run test backup manually
/home/admin/infra/cron/backup-db.sh
```

### Restore Fails
```bash
# Check logs
tail -50 /var/log/backup-db.log

# Check database container status
docker exec teen_postgres pg_isready -U teen -d teen_db

# Check backup file integrity
gunzip -t /home/admin/backups/postgres/backup-2026-07-11-12-00.sql.gz

# Try manual restore
gunzip -c /home/admin/backups/postgres/backup-2026-07-11-12-00.sql.gz | \
  docker exec -i teen_postgres psql -U teen -d teen_db 2>&1 | tail -20
```

### No Space Left on Device
```bash
# Check disk usage
df -h /home/admin/backups/postgres/

# Force cleanup of backups older than 7 days (emergency only!)
find /home/admin/backups/postgres/ -name "backup-*.sql.gz" -mtime +7 -delete

# Then run backup again
/home/admin/infra/cron/backup-db.sh
```

---

## S3 Backup Upload (Optional Future Enhancement)

To add offsite backup to AWS S3:

1. Install AWS CLI:
   ```bash
   apt-get install -y awscli
   ```

2. Configure AWS credentials:
   ```bash
   aws configure  # or use IAM role on EC2
   ```

3. Add to backup script (after backup creation):
   ```bash
   aws s3 cp "$BACKUP_FILE" s3://your-bucket/teen-db-backups/
   ```

4. Update rotation to also cleanup S3:
   ```bash
   aws s3 rm s3://your-bucket/teen-db-backups/ --recursive --exclude "*" --include "backup-*" \
     --older-than 30
   ```

---

## Key Files

| File | Location | Purpose |
|------|----------|---------|
| Backup Script | `/home/admin/infra/cron/backup-db.sh` | Daily backup executor |
| Restore Script | `/home/admin/infra/cron/restore-db.sh` | Restore from backup |
| Cron Config | `crontab` | Scheduled backup trigger (2 AM UTC daily) |
| Logrotate Config | `/etc/logrotate.d/backup-db` | Log rotation (30-day retention) |
| Backup Storage | `/home/admin/backups/postgres/` | Compressed SQL backups |
| Backup Logs | `/var/log/backup-db.log` | Backup execution logs |

---

## Timeline

- **2026-07-11**: Backup infrastructure deployed and tested
  - Database size: ~50 MB uncompressed
  - Backup size: ~952 KB compressed
  - First backup created: `backup-2026-07-11-16-48.sql.gz`
  - Cron job: `0 2 * * * /home/admin/infra/cron/backup-db.sh`
  - Retention: 30 days (auto-rotation enabled)

---

## Contact & Support

For backup-related issues on the VPS:
- Check logs: `tail -50 /var/log/backup-db.log`
- Manual backup: `/home/admin/infra/cron/backup-db.sh`
- SSH: `ssh root@64.204.130.181` (key-based auth with `~/.ssh/id_ed25519`)
