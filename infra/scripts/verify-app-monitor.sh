#!/bin/bash

# Comprehensive App Monitor System Verification Script
# Run this on VPS to diagnose all app monitor issues
# Usage: bash verify-app-monitor.sh

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "==================================================================="
echo "APP MONITOR SYSTEM VERIFICATION"
echo "==================================================================="
echo ""

# Helper functions
pass() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
}

fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
}

warn() {
  echo -e "${YELLOW}⚠ WARN${NC}: $1"
}

info() {
  echo -e "${YELLOW}ℹ INFO${NC}: $1"
}

# ── CHECK 1: PM2 Services Status ──
echo ""
echo "CHECK 1: PM2 SERVICES STATUS"
echo "─────────────────────────────────────────"

CRITICAL_SERVICES=("teen-core-api" "teen-wallet" "teen-gateway" "teen-tp-engine" "teen-admin-svc" "teen-app-monitor" "teen-uptime-bot")

for svc in "${CRITICAL_SERVICES[@]}"; do
  if pm2 status | grep -q "$svc"; then
    STATUS=$(pm2 status | grep "$svc" | awk '{print $10}')
    if [[ "$STATUS" == "online" ]]; then
      pass "$svc is running"
    else
      fail "$svc status is: $STATUS"
    fi
  else
    fail "$svc not found in PM2"
  fi
done

# ── CHECK 2: App Monitor Service Logs ──
echo ""
echo "CHECK 2: APP MONITOR SERVICE LOGS"
echo "─────────────────────────────────────────"

if pm2 logs teen-app-monitor --nostream --lines 20 | grep -q "alert engine started"; then
  pass "Alert engine is running"
else
  warn "Alert engine startup log not found (may have restarted)"
fi

if pm2 logs teen-app-monitor --nostream --lines 20 | grep -q "listening on port"; then
  pass "App monitor service started"
else
  warn "App monitor startup log not found"
fi

# ── CHECK 3: Uptime Bot Data ──
echo ""
echo "CHECK 3: UPTIME BOT DATA FILE"
echo "─────────────────────────────────────────"

UPTIME_FILE="/opt/teen/uptime-status.json"

if [[ -f "$UPTIME_FILE" ]]; then
  pass "Uptime status file exists: $UPTIME_FILE"

  # Check file age
  FILE_AGE=$(($(date +%s) - $(stat -c %Y "$UPTIME_FILE")))
  if [[ $FILE_AGE -lt 120 ]]; then
    pass "Uptime file is recent (updated ${FILE_AGE}s ago)"
  else
    warn "Uptime file is stale (updated ${FILE_AGE}s ago, should be < 60s)"
  fi

  # Verify JSON structure
  if jq . "$UPTIME_FILE" > /dev/null 2>&1; then
    pass "Uptime file is valid JSON"

    # Check database status
    DB_UP=$(jq -r '.database.up' "$UPTIME_FILE")
    REDIS_UP=$(jq -r '.redis.up' "$UPTIME_FILE")
    GW_UP=$(jq -r '.publicWebsockets.gateway.up' "$UPTIME_FILE")
    AV_UP=$(jq -r '.publicWebsockets.aviator.up' "$UPTIME_FILE")

    [[ "$DB_UP" == "true" ]] && pass "PostgreSQL is UP" || fail "PostgreSQL is DOWN"
    [[ "$REDIS_UP" == "true" ]] && pass "Redis is UP" || fail "Redis is DOWN"
    [[ "$GW_UP" == "true" ]] && pass "Gateway WS is UP" || fail "Gateway WS is DOWN"
    [[ "$AV_UP" == "true" ]] && pass "Aviator WS is UP" || fail "Aviator WS is DOWN"
  else
    fail "Uptime file is invalid JSON"
  fi
else
  fail "Uptime status file does not exist: $UPTIME_FILE"
  info "Need to deploy uptime-bot service or create the file"
fi

# ── CHECK 4: Database Events ──
echo ""
echo "CHECK 4: MONITOR EVENTS IN DATABASE"
echo "─────────────────────────────────────────"

# Count events in last hour
EVENTS_1H=$(psql -U postgres -d teen_patti -t -c "SELECT COUNT(*) FROM monitor_events WHERE created_at > NOW() - INTERVAL '1 hour';" 2>/dev/null || echo "0")
echo "Events (last 1 hour): $EVENTS_1H"

if [[ "$EVENTS_1H" -gt 0 ]]; then
  pass "Mobile app is sending monitor events ($EVENTS_1H in last hour)"
else
  warn "No monitor events in last hour - mobile app may not be sending data"
fi

# Count sessions
SESSIONS=$(psql -U postgres -d teen_patti -t -c "SELECT COUNT(*) FROM monitor_sessions WHERE created_at > NOW() - INTERVAL '24 hours';" 2>/dev/null || echo "0")
echo "Sessions (last 24 hours): $SESSIONS"

# Count alerts
UNACKED_ALERTS=$(psql -U postgres -d teen_patti -t -c "SELECT COUNT(*) FROM monitor_alerts WHERE acknowledged = FALSE;" 2>/dev/null || echo "0")
echo "Unacknowledged alerts: $UNACKED_ALERTS"

if [[ "$UNACKED_ALERTS" -gt 0 ]]; then
  warn "There are $UNACKED_ALERTS unacknowledged alerts"
  psql -U postgres -d teen_patti -c "SELECT kind, severity, message, created_at FROM monitor_alerts WHERE acknowledged = FALSE LIMIT 5;" 2>/dev/null || true
fi

# ── CHECK 5: API Endpoints ──
echo ""
echo "CHECK 5: API ENDPOINTS CONNECTIVITY"
echo "─────────────────────────────────────────"

# Test app-monitor service directly
if curl -s http://127.0.0.1:3015/health | jq . > /dev/null 2>&1; then
  pass "App Monitor service (/health)"
else
  fail "App Monitor service unreachable at http://127.0.0.1:3015"
fi

# Test admin service proxy
if curl -s -H "Authorization: Bearer dummy" http://127.0.0.1:3000/api/admin/monitor/stats > /dev/null 2>&1; then
  pass "Admin service can reach app-monitor"
else
  fail "Admin service cannot reach app-monitor (may need JWT token)"
fi

# ── CHECK 6: Alert Engine Activity ──
echo ""
echo "CHECK 6: ALERT ENGINE ACTIVITY"
echo "─────────────────────────────────────────"

REMEDIATION_COUNT=$(psql -U postgres -d teen_patti -t -c "SELECT COUNT(*) FROM remediation_actions WHERE created_at > NOW() - INTERVAL '24 hours';" 2>/dev/null || echo "0")
echo "Auto-remediation attempts (last 24h): $REMEDIATION_COUNT"

if [[ "$REMEDIATION_COUNT" -gt 0 ]]; then
  info "Alert engine is actively remediating services"
  psql -U postgres -d teen_patti -c "SELECT target, action, result, COUNT(*) FROM remediation_actions WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY target, action, result;" 2>/dev/null || true
fi

# ── CHECK 7: Uptime Bot Service ──
echo ""
echo "CHECK 7: UPTIME BOT SERVICE"
echo "─────────────────────────────────────────"

if pm2 status | grep -q "teen-uptime-bot"; then
  STATUS=$(pm2 status | grep "teen-uptime-bot" | awk '{print $10}')
  if [[ "$STATUS" == "online" ]]; then
    pass "Uptime bot is running"
  else
    fail "Uptime bot status is: $STATUS"
    info "Try: pm2 restart teen-uptime-bot"
  fi
else
  fail "Uptime bot not found in PM2"
  info "Need to deploy uptime-bot service"
fi

# ── CHECK 8: Mobile Event Ingestion ──
echo ""
echo "CHECK 8: MOBILE EVENT INGESTION"
echo "─────────────────────────────────────────"

# Check for ingestion errors in logs
INGEST_ERRORS=$(pm2 logs teen-app-monitor --nostream --lines 100 | grep -c "Ingest error" || echo "0")

if [[ "$INGEST_ERRORS" -eq 0 ]]; then
  pass "No ingest errors in recent logs"
else
  warn "Found $INGEST_ERRORS ingest errors in logs"
  pm2 logs teen-app-monitor --nostream --lines 20 | grep "Ingest error" || true
fi

# ── SUMMARY ──
echo ""
echo "==================================================================="
echo "SUMMARY"
echo "==================================================================="
echo ""
info "✓ All critical checks can be run from VPS"
info "✓ Use 'pm2 logs teen-app-monitor' to watch live events"
info "✓ Use 'pm2 logs teen-uptime-bot' to watch uptime checks"
info "✓ Monitor database: SELECT * FROM monitor_events WHERE created_at > NOW() - INTERVAL '1 hour';"
echo ""
echo "NEXT STEPS:"
echo "1. If uptime-bot not running: Deploy it from services/uptime-bot"
echo "2. If no mobile events: Check mobile app INGEST_SECRET_KEY and APP_MONITOR_SERVICE_URL"
echo "3. If API errors: Check admin-service can reach app-monitor on port 3015"
echo "4. Check admin panel: AI Control Center → App Monitor tab"
echo ""
