#!/usr/bin/env bash
#
# Deploy the Teen Patti tip/gift/bot-fill release to the VPS.
#
# Run on the VPS (64.204.130.181):
#   cd /opt/teen && git pull origin claude/confident-archimedes-e2dd1k && bash infra/deploy/deploy-tip-gifts-botfill.sh
#
# Brings live:
#   - migration 029      : txn_type_enum += 'tip_dealer', DROP TABLE game_gifts
#   - game_configs       : teen_patti bot_fill_table_size=4, bot_fill_enabled=true
#   - game-gateway       : room:tip wallet debit + broadcast, gift chat type
#                          removed, teen_patti 4-seat bot-fill code fallback
#   - admin-service      : gift endpoints removed
#   - admin-panel        : Gifts section removed from Teen Patti page
#
# The wallet withdrawal-window + UPI deep-link changes are mobile-only (APK).
# Secrets live only in the per-service .env files already on the VPS.
set -euo pipefail

REPO=/opt/teen
BRANCH=claude/confident-archimedes-e2dd1k
WEBROOT=/home/admin/web/game.myonlinejoker.com/public_html/admin/

cd "$REPO"

echo "==> Pull latest"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "==> Migration 029 (tip_dealer enum + drop game_gifts)"
docker exec -i teen_postgres psql -U teen -d teen_db \
  < "$REPO/infra/db/migrations/029_tip_dealer_drop_gifts.sql" \
  || echo "   (029 may already be applied)"

echo "==> Enforce teen_patti bot-fill config (4-seat table)"
docker exec -i teen_postgres psql -U teen -d teen_db -c \
  "UPDATE game_configs SET bot_fill_table_size = 4, bot_fill_enabled = true WHERE game_type = 'teen_patti';"

echo "==> Build game-gateway"
cd "$REPO/services/game-gateway"
npm install --no-audit --no-fund
npm run build

echo "==> Build admin-service"
cd "$REPO/services/admin-service"
npm install --no-audit --no-fund
npm run build

echo "==> Restart services"
pm2 restart teen-gateway teen-admin-svc --update-env

echo "==> Build + deploy admin panel"
cd "$REPO/admin-panel"
npm install --production=false
npm run build
cp -rf "$REPO/admin-panel/dist/." "$WEBROOT"

echo "==> Health check"
sleep 3
pm2 status teen-gateway teen-admin-svc
pm2 logs teen-gateway --lines 10 --nostream

echo "Done."
echo "Verify: 2 phones same stake -> table fills to 4 with 2 bots;"
echo "        in-game Tip button debits wallet (txn type tip_dealer);"
echo "        gift button gone from app + admin Teen Patti page."
