#!/bin/bash
# Run this ONCE to create .env files from examples
# Edit each file with your actual credentials after running

BASE=/opt/teen-prod
# auth-service/user-service/betting-service/leaderboard-service/notification-service
# were pre-consolidation services that no longer exist as separate deployables
# (merged into core-api-service, per CLAUDE.md) -- core-api-service itself was
# never in this list, so a fresh VPS would leave it on .env.example's JWT_SECRET/
# INTERNAL_SERVICE_KEY placeholders, breaking auth/internal-call verification
# platform-wide. monitoring-service/risk-service/churn-service/app-monitor-service/
# bot-learning-service were also missing -- bot-learning-service's missing
# INTERNAL_SERVICE_KEY was hit live on 2026-07-29 (services/bot-learning-service
# had zero routes it could authenticate until this was patched by hand).
SERVICES=(core-api-service wallet-service game-gateway admin-service monitoring-service risk-service churn-service app-monitor-service bot-learning-service)

# Generate ONE value per shared secret so every service agrees. A mismatched
# JWT_SECRET between auth-service (signs tokens) and game-gateway (verifies
# them) makes the gateway reject every socket handshake — the realtime games
# silently fail to connect. Generating once here removes that whole class of
# bug instead of relying on the operator to paste identical values by hand.
JWT_SECRET="$(openssl rand -hex 32)"
JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
INTERNAL_SERVICE_KEY="$(openssl rand -hex 32)"

for svc in "${SERVICES[@]}"; do
  ENV_DEST="$BASE/services/$svc/.env"
  ENV_EXAMPLE="$BASE/services/$svc/.env.example"
  if [ -f "$ENV_EXAMPLE" ] && [ ! -f "$ENV_DEST" ]; then
    cp "$ENV_EXAMPLE" "$ENV_DEST"
    # Replace the shared-secret placeholders with the generated values so all
    # services share the same JWT_SECRET / refresh secret / internal key.
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$ENV_DEST"
    sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}|" "$ENV_DEST"
    sed -i "s|^INTERNAL_SERVICE_KEY=.*|INTERNAL_SERVICE_KEY=${INTERNAL_SERVICE_KEY}|" "$ENV_DEST"
    echo "Created: $ENV_DEST"
  fi
done

# Create aviator engine env
AVIATOR_ENV="$BASE/services/game-engines/aviator/.env"
if [ ! -f "$AVIATOR_ENV" ]; then
cat > "$AVIATOR_ENV" << ENV
PORT=3005
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@localhost:5432/teen_db
REDIS_URL=redis://:teen_redis_2024@localhost:6379
JWT_SECRET=${JWT_SECRET}
WALLET_SERVICE_URL=http://localhost:3003
INTERNAL_SERVICE_KEY=${INTERNAL_SERVICE_KEY}
ENV
  echo "Created: $AVIATOR_ENV"
fi

# Create ludo engine env (HTTP engine behind the gateway, no JWT needed).
LUDO_ENV="$BASE/services/game-engines/ludo/.env"
if [ ! -f "$LUDO_ENV" ]; then
cat > "$LUDO_ENV" << ENV
PORT=3011
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@localhost:5432/teen_db
REDIS_URL=redis://:teen_redis_2024@localhost:6379
ENV
  echo "Created: $LUDO_ENV"
fi

# Create Teen Patti engine env (Go binary, no JWT needed — same as Ludo).
# This was never generated at all before 2026-07-29: the Go binary can't parse
# dotenv itself, so a missing .env here silently falls back to the hardcoded
# DB/Redis credentials baked into main.go rather than a hard failure. No PORT
# here deliberately — ecosystem.config.js's LOAD_ENV() merges this file's keys
# in *after* setting PORT: '3010' in its own env object, so a PORT line here
# would silently override that default instead of just being redundant with it.
TEEN_PATTI_ENV="$BASE/services/game-engines/teen-patti/.env"
if [ ! -f "$TEEN_PATTI_ENV" ]; then
cat > "$TEEN_PATTI_ENV" << ENV
DATABASE_URL=postgresql://teen:teen_secret_2024@localhost:5432/teen_db
REDIS_URL=redis://:teen_redis_2024@localhost:6379
INTERNAL_SERVICE_KEY=${INTERNAL_SERVICE_KEY}
ENV
  echo "Created: $TEEN_PATTI_ENV"
fi

echo ""
echo "==> Shared secrets (JWT_SECRET, JWT_REFRESH_SECRET, INTERNAL_SERVICE_KEY)"
echo "    were generated and written identically into every service .env."
echo "==> STILL EDIT THESE per-service credentials:"
echo "  - DATABASE_URL / REDIS_URL (real passwords)"
echo "  - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET"
echo "  - FIREBASE_SERVICE_ACCOUNT_JSON"
echo "  - ADMIN_JWT_SECRET"
