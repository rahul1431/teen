#!/bin/bash

# infra/cron/metrics-aggregation.sh
# Hourly metrics aggregation cron job — runs every hour at :00
# Aggregates bot performance metrics and inserts into bot_profile_metrics table

set -e

# Load environment
if [ -f /home/app/.env ]; then
  set -a
  source /home/app/.env
  set +a
fi

# Set default variables
METRICS_SERVICE_URL="${METRICS_SERVICE_URL:-http://localhost:3014}"
TIMEOUT="${TIMEOUT:-60}"
LOG_FILE="${LOG_FILE:-/var/log/metrics-aggregation.log}"

# Logging function
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Error handling
error_exit() {
  log "ERROR: $1"
  exit 1
}

log "Starting hourly metrics aggregation..."

# Call metrics aggregation endpoint (internal only, no auth required for localhost)
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  --max-time "$TIMEOUT" \
  "$METRICS_SERVICE_URL/internal/metrics/aggregate" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" != "200" ]; then
  error_exit "Metrics aggregation failed with HTTP $HTTP_CODE: $BODY"
fi

log "Metrics aggregation completed successfully"
log "Response: $BODY"

exit 0
