#!/bin/bash
# Run this ONCE to create .env files from examples
# Edit each file with your actual credentials after running

BASE=/opt/teen
SERVICES=(auth-service user-service wallet-service game-gateway leaderboard-service notification-service admin-service)

for svc in "${SERVICES[@]}"; do
  ENV_DEST="$BASE/services/$svc/.env"
  ENV_EXAMPLE="$BASE/services/$svc/.env.example"
  if [ -f "$ENV_EXAMPLE" ] && [ ! -f "$ENV_DEST" ]; then
    cp "$ENV_EXAMPLE" "$ENV_DEST"
    echo "Created: $ENV_DEST"
  fi
done

# Create aviator engine env
AVIATOR_ENV="$BASE/services/game-engines/aviator/.env"
if [ ! -f "$AVIATOR_ENV" ]; then
cat > "$AVIATOR_ENV" << 'ENV'
PORT=3005
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@localhost:5432/teen_db
REDIS_URL=redis://:teen_redis_2024@localhost:6379
JWT_SECRET=change_this_jwt_secret_in_production_min_32_chars
WALLET_SERVICE_URL=http://localhost:3003
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
ENV
  echo "Created: $AVIATOR_ENV"
fi

echo ""
echo "==> .env files created. NOW EDIT THESE with your actual credentials:"
echo "  - JWT_SECRET (generate: openssl rand -hex 32)"
echo "  - JWT_REFRESH_SECRET"
echo "  - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET"
echo "  - FIREBASE_SERVICE_ACCOUNT_JSON"
echo "  - INTERNAL_SERVICE_KEY"
echo "  - ADMIN_JWT_SECRET"
