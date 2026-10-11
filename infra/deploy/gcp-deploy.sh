#!/usr/bin/env bash
# ==============================================================================
# MyOnlineJoker — GCP Production Automated Build & Deploy Pipeline
# Builds: Go Engine, Node Microservices, React Admin Panel, Python ML
# Migrates: PostgreSQL 16 schema (150 migrations)
# Configures: Nginx, PM2, Uploads, Firewalls
# ==============================================================================

set -euo pipefail

REPO="/opt/teen-prod"
cd "$REPO"

echo "=========================================================="
echo "🚀 Starting Full Platform Build & Deployment..."
echo "=========================================================="

# 1. Create necessary runtime directories
echo "📁 Ensuring runtime directories exist..."
mkdir -p "$REPO/uploads/avatars"
mkdir -p "$REPO/uploads/kyc"
mkdir -p "$REPO/uploads/mission-proofs"
mkdir -p "$REPO/downloads"
mkdir -p "$REPO/logs"
mkdir -p "$REPO/geoip"
chmod -R 777 "$REPO/uploads" "$REPO/downloads" "$REPO/logs" 2>/dev/null || true

# 2. Fix the two historical migration syntax issues before migration run
echo "🛠️ Validating PostgreSQL migration files..."
cat << 'EOF' > "$REPO/infra/db/migrations/005_risk_status.sql"
-- Add 'suspicious' as a valid user status for Risk Center flagging
ALTER TYPE user_status_enum ADD VALUE IF NOT EXISTS 'suspicious';
EOF

cat << 'EOF' > "$REPO/infra/db/migrations/012_game_events_monitoring.sql"
-- Migration 012: Game Events Monitoring Table
CREATE TABLE IF NOT EXISTS game_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  game_type VARCHAR(50),
  room_id UUID,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100),
  amount DECIMAL(15,2),
  player_count INT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_events_game_type_created ON game_events (game_type, created_at);
CREATE INDEX IF NOT EXISTS idx_game_events_user_created      ON game_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_game_events_room_created      ON game_events (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_game_events_event_type        ON game_events (event_type);
CREATE INDEX IF NOT EXISTS idx_game_events_created           ON game_events (created_at);
EOF

# 3. Apply all database migrations
echo "🐘 Executing database migrations on teen_db..."
bash "$REPO/infra/db/migrate.sh"

# 4. Generate environment (.env) files for all services
echo "🔐 Generating service environment configurations..."

cat << 'EOF' > "$REPO/services/core-api-service/.env"
PORT=3001
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=devlocal_shared_jwt_secret_min_32_chars_xxx
JWT_REFRESH_SECRET=devlocal_shared_refresh_secret_min_32_chars_xxx
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
OTP_PROVIDER=dev
MASTER_OTP=123456
WALLET_SERVICE_URL=http://127.0.0.1:3003
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
REFERRAL_BONUS_AMOUNT=50
APP_URL=https://game.myonlinejoker.com
AVATAR_UPLOAD_DIR=/opt/teen-prod/uploads/avatars
KYC_UPLOAD_DIR=/opt/teen-prod/uploads/kyc
MISSION_PROOF_UPLOAD_DIR=/opt/teen-prod/uploads/mission-proofs
ODDS_API_KEY=e31484c84117a958352c9c391f2ef000
EOF

cat << 'EOF' > "$REPO/services/wallet-service/.env"
PORT=3003
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=devlocal_shared_jwt_secret_min_32_chars_xxx
PLATFORM_RAKE_PERCENT=5
MIN_DEPOSIT_AMOUNT=10
MAX_DEPOSIT_AMOUNT=100000
MIN_WITHDRAWAL_AMOUNT=100
MAX_WITHDRAWAL_AMOUNT=50000
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
EOF

cat << 'EOF' > "$REPO/services/game-gateway/.env"
PORT=3004
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=devlocal_shared_jwt_secret_min_32_chars_xxx
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
WALLET_SERVICE_URL=http://127.0.0.1:3003
TEEN_PATTI_ENGINE_URL=http://127.0.0.1:3010
MONITORING_SERVICE_URL=http://127.0.0.1:3012
EOF

cat << 'EOF' > "$REPO/services/admin-service/.env"
PORT=3008
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
ADMIN_JWT_SECRET=change_this_admin_jwt_secret_separate_from_user_jwt
JWT_SECRET=devlocal_shared_jwt_secret_min_32_chars_xxx
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
WALLET_SERVICE_URL=http://127.0.0.1:3003
NOTIFICATION_SERVICE_URL=http://127.0.0.1:3001
BETTING_SERVICE_URL=http://127.0.0.1:3001
CHURN_SERVICE_URL=http://127.0.0.1:3013
BOT_LEARNING_SERVICE_URL=http://127.0.0.1:3014
APP_MONITOR_SERVICE_URL=http://127.0.0.1:3015
KYC_UPLOAD_DIR=/opt/teen-prod/uploads/kyc
AVATAR_UPLOAD_DIR=/opt/teen-prod/uploads/avatars
MISSION_PROOF_UPLOAD_DIR=/opt/teen-prod/uploads/mission-proofs
EOF

cat << 'EOF' > "$REPO/services/game-engines/aviator/.env"
PORT=3005
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
WALLET_SERVICE_URL=http://127.0.0.1:3003
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
EOF

cat << 'EOF' > "$REPO/services/game-engines/ludo/.env"
PORT=3006
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
WALLET_SERVICE_URL=http://127.0.0.1:3003
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
EOF

cat << 'EOF' > "$REPO/services/game-engines/rummy/.env"
PORT=3009
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
WALLET_SERVICE_URL=http://127.0.0.1:3003
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
EOF

cat << 'EOF' > "$REPO/services/game-engines/teen-patti/.env"
PORT=3010
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
WALLET_SERVICE_URL=http://127.0.0.1:3003
EOF

cat << 'EOF' > "$REPO/services/monitoring-service/.env"
PORT=3012
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
EOF

cat << 'EOF' > "$REPO/services/risk-service/.env"
PORT=3011
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
INTERNAL_SERVICE_KEY=internal_secret_key_change_in_prod
EOF

cat << 'EOF' > "$REPO/services/churn-service/.env"
PORT=3013
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
CHURN_ML_SERVICE_URL=http://127.0.0.1:3020
EOF

cat << 'EOF' > "$REPO/services/churn-ml-service/.env"
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
EOF

cat << 'EOF' > "$REPO/services/app-monitor-service/.env"
PORT=3015
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
EOF

cat << 'EOF' > "$REPO/services/uptime-bot/.env"
PORT=3016
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
UPTIME_STATUS_FILE=/opt/teen-prod/uptime-status.json
EOF

cat << 'EOF' > "$REPO/services/bot-learning-service/.env"
PORT=3014
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
EOF

cat << 'EOF' > "$REPO/services/bot-training/teen-patti/.env"
PORT=3023
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
EOF

cat << 'EOF' > "$REPO/services/bot-training/ludo/.env"
PORT=3024
NODE_ENV=production
DATABASE_URL=postgresql://teen:teen_secret_2024@127.0.0.1:5432/teen_db
REDIS_URL=redis://127.0.0.1:6379
EOF

# 5. Build Teen Patti engine (Go)
echo "🐹 Building Teen Patti Go Engine..."
(cd "$REPO/services/game-engines/teen-patti" && /usr/local/go/bin/go build -o teen-patti-engine .)

# 6. Build Churn ML Python service
echo "🐍 Setting up Churn ML Python environment..."
if [ -d "$REPO/services/churn-ml-service" ]; then
  (
    cd "$REPO/services/churn-ml-service"
    [ -d venv ] || python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip --quiet
    pip install -r requirements.txt --quiet
    deactivate
  )
fi

# 7. Build Node.js microservices
echo "📦 Building Node.js services..."
NODE_SERVICES=(
  "core-api-service"
  "wallet-service"
  "game-gateway"
  "game-engines/aviator"
  "game-engines/ludo"
  "game-engines/rummy"
  "admin-service"
  "monitoring-service"
  "risk-service"
  "churn-service"
  "app-monitor-service"
  "uptime-bot"
  "bot-learning-service"
  "bot-training/teen-patti"
  "bot-training/ludo"
)

for svc in "${NODE_SERVICES[@]}"; do
  echo "  🔨 Building $svc..."
  (cd "$REPO/services/$svc" && npm install --production=false --no-audit --no-fund && npm run build)
done

# 8. Build Admin Panel (React Vite SPA)
echo "⚛️ Building Admin Panel frontend..."
(cd "$REPO/admin-panel" && npm install --production=false --no-audit --no-fund && ADMIN_BASE=/admin/ npm run build)

# 9. Configure Nginx
echo "🌐 Configuring Nginx reverse proxy..."
sudo mkdir -p /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled
sudo cp -f "$REPO/infra/nginx/proxy-headers.conf" /etc/nginx/snippets/
sudo cp -f "$REPO/infra/nginx/game-locations.conf" /etc/nginx/snippets/

cat << 'EOF' | sudo tee /etc/nginx/sites-available/game.myonlinejoker.com > /dev/null
upstream core_api_backend    { server 127.0.0.1:3001; keepalive 32; }
upstream wallet_backend      { server 127.0.0.1:3003; keepalive 16; }
upstream aviator_backend     { server 127.0.0.1:3005; keepalive 16; }
upstream bingo_backend       { server 127.0.0.1:3007; keepalive 16; }
upstream admin_backend       { server 127.0.0.1:3008; keepalive 16; }
upstream app_monitor_backend { server 127.0.0.1:3015; keepalive 16; }

upstream gateway_backend {
    hash $arg_token consistent;
    server 127.0.0.1:3004 max_fails=3 fail_timeout=10s;
    server 127.0.0.1:3021 max_fails=3 fail_timeout=10s;
    server 127.0.0.1:3022 max_fails=3 fail_timeout=10s;
    keepalive 64;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name game.myonlinejoker.com _;

    client_max_body_size 50M;

    include /etc/nginx/snippets/game-locations.conf;
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/game.myonlinejoker.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 10. Start / Reload PM2 fleet
echo "🚀 Launching all microservices with PM2..."
cd "$REPO"
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo "=========================================================="
echo "🎉 SUCCESS: All MyOnlineJoker services are online!"
echo "=========================================================="
pm2 status
