#!/bin/bash
# Deploy script for HestiaCP VPS
# Run as root from repository root after git pull

set -e
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HESTIA_USER=${HESTIA_USER:-admin}  # Change to your actual Hestia username

echo "==> Building Node.js services..."
SERVICES=(auth-service user-service wallet-service game-gateway leaderboard-service notification-service admin-service)
for svc in "${SERVICES[@]}"; do
  echo "  -> $svc"
  cd "$BASE/services/$svc"
  npm install --production=false 2>/dev/null
  npm run build
done

echo "==> Building Aviator engine..."
cd "$BASE/services/game-engines/aviator"
npm install --production=false 2>/dev/null
npm run build

echo "==> Building Teen Patti Go engine..."
cd "$BASE/services/game-engines/teen-patti"
/usr/local/go/bin/go mod tidy
/usr/local/go/bin/go build -o teen-patti-engine .

echo "==> Building Admin Panel..."
cd "$BASE/admin-panel"
npm install 2>/dev/null
npm run build

echo "==> Setting up Hestia Nginx proxy config..."
# Filenames must match what nginx-protect.sh and deploy-services.sh use
# (nginx.conf_api / nginx.ssl.conf_api) — HestiaCP only serves those two,
# so writing to any other name silently has no effect on live traffic.
NGINX_CONF_DIR="/home/${HESTIA_USER}/conf/web/game.myonlinejoker.com"
mkdir -p "$NGINX_CONF_DIR"
cp "$BASE/infra/nginx/hestia-proxy.conf" "$NGINX_CONF_DIR/nginx.conf_api"
cp "$BASE/infra/nginx/hestia-proxy.conf" "$NGINX_CONF_DIR/nginx.ssl.conf_api"

# Reload Nginx via Hestia
v-restart-web 2>/dev/null || nginx -s reload 2>/dev/null || systemctl reload nginx

echo "==> Starting DB..."
cd "$BASE"
docker compose up -d
sleep 8

echo "==> Running DB migrations..."
docker exec teen_postgres psql -U teen -d teen_db -f /docker-entrypoint-initdb.d/001_initial.sql 2>/dev/null || true
docker exec teen_postgres psql -U teen -d teen_db -f /docker-entrypoint-initdb.d/002_notifications.sql 2>/dev/null || true

echo "==> Starting services with PM2..."
pm2 delete all 2>/dev/null || true
pm2 start "$BASE/ecosystem.config.js"
pm2 save

# Register PM2 to start on reboot
pm2 startup systemd -u root --hp /root 2>/dev/null | grep "sudo" | bash || true

echo ""
echo "==> DEPLOYMENT COMPLETE!"
echo ""
echo "  API:          https://game.myonlinejoker.com/api/auth/health"
echo "  Admin Panel:  https://game.myonlinejoker.com/admin/"
echo "  Socket.IO:    wss://game.myonlinejoker.com/socket.io/"
echo "  Aviator WS:   wss://game.myonlinejoker.com/aviator/"
echo ""
echo "  PM2 status:   pm2 status"
echo "  PM2 logs:     pm2 logs teen-auth --lines 100"
echo ""
echo "  Admin login:  username=superadmin  password=Admin@123456"
echo "  !! CHANGE THE PASSWORD IMMEDIATELY !!"
