#!/usr/bin/env bash
#
# Deploy the game-gateway update (private friends tables + matchmaking fixes)
# to the VPS.
#
# Run on the VPS (64.204.130.181) as the deploy user:
#   ssh <user>@64.204.130.181
#   cd /opt/teen && git pull origin claude/confident-archimedes-e2dd1k && bash infra/deploy/deploy-gateway-friends-matchmaking.sh
#
# Brings live:
#   - game-gateway : private:create/join/leave/start handlers (friends tables),
#                    bot_fill_table_size matchmaking, min_players fallback when
#                    bot-fill is disabled, per-action wallet locks, monitor events
#
# Secrets live only in the per-service .env files already on the VPS.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRANCH=claude/confident-archimedes-e2dd1k

cd "$REPO"

echo "==> Pull latest"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "==> Build game-gateway"
cd "$REPO/services/game-gateway"
npm install --no-audit --no-fund
npm run build

echo "==> Restart gateway"
pm2 restart teen-gateway --update-env

echo "==> Health check"
sleep 3
pm2 status teen-gateway
pm2 logs teen-gateway --lines 15 --nostream

echo "Done. Test: two phones, same stake, Play Now — both should land at one table."
echo "Friends tables: Create Table on phone A, Join with the code on phone B."
