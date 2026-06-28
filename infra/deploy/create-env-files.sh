#!/bin/bash
# Run this ONCE to create .env files from examples
# Edit each file with your actual credentials after running

BASE=/opt/teen
SERVICES=(auth-service user-service wallet-service game-gateway betting-service leaderboard-service notification-service admin-service)

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

echo ""
echo "==> Shared secrets (JWT_SECRET, JWT_REFRESH_SECRET, INTERNAL_SERVICE_KEY)"
echo "    were generated and written identically into every service .env."
echo "==> STILL EDIT THESE per-service credentials:"
echo "  - DATABASE_URL / REDIS_URL (real passwords)"
echo "  - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET"
echo "  - FIREBASE_SERVICE_ACCOUNT_JSON"
echo "  - ADMIN_JWT_SECRET"
