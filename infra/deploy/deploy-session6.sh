#!/usr/bin/env bash
#
# Phase 8 — deploy session 6 + Phase 7 changes to the VPS.
#
# Run on the VPS (64.204.130.181) as the deploy user, from /opt/teen.
#   ssh <user>@64.204.130.181
#   cd /opt/teen && bash infra/deploy/deploy-session6.sh
#
# Brings live:
#   - Aviator engine   : admin-configurable economics (house edge/rake/maxWin)
#   - Admin service    : special_rules JSONB merge on PATCH /game-configs
#   - Admin panel      : "Aviator Economics" config UI
#   - Nginx            : /aviator/ websocket route (so the APK reaches port 3005)
#
# Secrets live only in the per-service .env files already on the VPS — this
# script never writes or echoes them.
set -euo pipefail

REPO=/opt/teen
BRANCH=claude/confident-archimedes-e2dd1k

cd "$REPO"

echo "==> Pull latest"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "==> Build aviator engine (new economics)"
cd "$REPO/services/game-engines/aviator"
npm install --no-audit --no-fund
npm install dotenv --no-audit --no-fund   # imported via 'dotenv/config' but not in package.json
npm run build

echo "==> Build admin-service (special_rules merge)"
cd "$REPO/services/admin-service"
npm install --no-audit --no-fund
npm install dotenv --no-audit --no-fund
npm run build

echo "==> Build admin panel (Aviator Economics UI)"
cd "$REPO/admin-panel"
npm install --no-audit --no-fund
# Build with the same flags used in session 4 (served under /admin/).
VITE_API_BASE_URL="" npm run build -- --base=/admin/

echo "==> Restart services"
pm2 restart teen-aviator teen-admin-svc
pm2 save

echo "==> Reload nginx (ensure /aviator/ websocket route is present)"
# The /aviator/ block lives in infra/nginx/hestia-proxy.conf. If your HestiaCP
# custom config does not yet include it, paste that block into:
#   /home/<hestia_user>/conf/web/game.myonlinejoker.com/nginx.ssl.conf_proxy
# then:
nginx -t && systemctl reload nginx

echo "==> Smoke check"
curl -fsS http://127.0.0.1:3005/health && echo
echo "Done. Verify in admin panel → Game Config → Aviator Economics, change a"
echo "value, save, and confirm the next Aviator round reflects it."
