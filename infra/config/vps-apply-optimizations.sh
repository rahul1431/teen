#!/usr/bin/env bash
# Run on VPS as root/sudo to apply all performance optimizations.
# Usage: sudo bash /opt/teen/infra/config/vps-apply-optimizations.sh

set -e
BASE=/opt/teen

echo "=== [1/5] OS sysctl tuning ==="
cp $BASE/infra/config/sysctl.conf /etc/sysctl.d/99-teen.conf
sysctl --system

echo "=== [2/5] File descriptor limits ==="
cp $BASE/infra/config/limits.conf /etc/security/limits.d/99-teen.conf
echo "Limits written. Take effect on next login/restart."

echo "=== [3/5] Build & install core-api-service ==="
cd $BASE/services/core-api-service
npm install --omit=dev
npm run build
pm2 start ecosystem.config.js --only teen-core-api

echo "=== [4/5] Restart PM2 ecosystem ==="
cd $BASE
pm2 reload ecosystem.config.js
# Pre-consolidation process names (merged into teen-core-api) — safe no-op
# if already gone. teen-bot-learning is NOT in this group: it's a live app
# in ecosystem.config.js running the nightly bot-profile rebuild job, and
# must not be deleted here.
pm2 delete teen-auth teen-user teen-leaderboard teen-notify teen-betting 2>/dev/null || true
pm2 save

echo "=== [5/5] Reload nginx ==="
nginx -t && systemctl reload nginx

echo ""
echo "Done. Run 'pm2 list' to verify process count dropped."
echo "Run 'pm2 monit' to check memory per process."
echo ""
echo "Docker (PostgreSQL + Redis) tuning takes effect on next 'docker compose up':"
echo "  cd $BASE && docker compose down && docker compose up -d"
echo ""
echo "Run the DB migration to add UNIQUE constraint on wallet idempotency key:"
echo "  psql \$DATABASE_URL -f $BASE/infra/db/migrations/024_wallet_idempotency_unique.sql"
