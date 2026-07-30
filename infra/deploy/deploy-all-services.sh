#!/usr/bin/env bash
# Routine full-fleet deploy: builds every Node/Go/Python service and the
# admin panel, applies any new DB migrations, and restarts every PM2 app
# individually (never `pm2 delete all` — a bad build in one service should
# not take the whole platform offline while it restarts).
#
# This replaces the narrower deploy-tip-gifts-botfill.sh as what go.sh
# calls for routine deploys — see docs/Bugs/deploy-pipeline-live-path-
# skips-most-pm2-services.md for why that was insufficient (it only ever
# rebuilt game-gateway + admin-service, leaving 14 other PM2 processes on
# stale code with no warning). One-time VPS setup (Node/Go/Docker/Nginx
# install, firewall) stays in bootstrap-vps.sh; this script never touches
# system packages, nginx config, or docker compose.
#
# Run on the VPS (64.204.130.181), as root:
#   cd /opt/teen-prod && git pull origin claude/confident-archimedes-e2dd1k && bash infra/deploy/deploy-all-services.sh
set -euo pipefail

REPO=/opt/teen-prod
WEBROOT=/home/admin/web/game.myonlinejoker.com/public_html/admin/

cd "$REPO"

# cwd (relative to services/) -> PM2 app name(s), space-separated for
# services backing more than one process (game-gateway's 3 fork instances).
declare -A SERVICE_APPS=(
  [core-api-service]="teen-core-api"
  [wallet-service]="teen-wallet"
  [game-gateway]="teen-gateway teen-gateway-2 teen-gateway-3"
  [game-engines/aviator]="teen-aviator"
  [game-engines/ludo]="teen-ludo"
  [game-engines/rummy]="teen-rummy"
  [admin-service]="teen-admin-svc"
  [monitoring-service]="teen-monitoring"
  [risk-service]="teen-risk"
  [churn-service]="teen-churn"
  [app-monitor-service]="teen-app-monitor"
  [uptime-bot]="teen-uptime-bot"
  [bot-learning-service]="teen-bot-learning"
)

echo "==> Building Node services"
for svc in "${!SERVICE_APPS[@]}"; do
  echo "  -> $svc"
  (cd "$REPO/services/$svc" && npm install --production=false --no-audit --no-fund && npm run build)
done

echo "==> Building Teen Patti engine (Go)"
(cd "$REPO/services/game-engines/teen-patti" && /usr/local/go/bin/go build -o teen-patti-engine .)

echo "==> Installing churn-ml-service dependencies (Python)"
if [ -d "$REPO/services/churn-ml-service" ]; then
  (
    cd "$REPO/services/churn-ml-service"
    [ -d venv ] || python3 -m venv venv
    # shellcheck disable=SC1091
    source venv/bin/activate
    pip install --upgrade pip --quiet
    pip install -r requirements.txt --quiet
    deactivate
  )
fi

echo "==> Building admin panel and deploying to webroot"
(cd "$REPO/admin-panel" && npm install --production=false --no-audit --no-fund && npm run build)
cp -rf "$REPO/admin-panel/dist/." "$WEBROOT"

echo "==> Applying pending DB migrations"
bash "$REPO/infra/db/migrate.sh"

echo "==> Restarting services"
for svc in "${!SERVICE_APPS[@]}"; do
  # shellcheck disable=SC2086
  pm2 restart ${SERVICE_APPS[$svc]} --update-env
done
# Go binary and Python service have no npm build step above but still need
# a restart to pick up their freshly rebuilt binary / freshly installed deps.
pm2 restart teen-tp-engine teen-churn-ml --update-env
pm2 save

echo "==> Post-deploy status"
sleep 3
pm2 status

echo "Done."
