#!/bin/bash
# Run from /opt/teen after git pull
set -e

BASE=/opt/teen
SERVICES=(auth-service user-service wallet-service game-gateway betting-service leaderboard-service notification-service admin-service monitoring-service risk-service churn-service bot-learning-service app-monitor-service)

echo "==> Installing dependencies and building Node.js services..."
for svc in "${SERVICES[@]}"; do
  echo "  -> Building $svc..."
  cd "$BASE/services/$svc"
  npm install --production=false
  npm run build
done

echo "==> Installing Aviator engine dependencies..."
cd "$BASE/services/game-engines/aviator"
npm install --production=false
npm run build

echo "==> Installing Ludo engine dependencies..."
cd "$BASE/services/game-engines/ludo"
npm install --production=false
npm run build

echo "==> Building Teen Patti Go engine..."
cd "$BASE/services/game-engines/teen-patti"
/usr/local/go/bin/go mod tidy
/usr/local/go/bin/go build -o teen-patti-engine .

echo "==> Setting up Nginx..."
mkdir -p /etc/nginx/snippets
cp "$BASE/infra/nginx/proxy-headers.conf" /etc/nginx/snippets/
cp "$BASE/infra/nginx/game.myonlinejoker.com.conf" /etc/nginx/sites-available/game.myonlinejoker.com
ln -sf /etc/nginx/sites-available/game.myonlinejoker.com /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Starting DB containers..."
cd "$BASE"
docker compose up -d
echo "  Waiting for DB to be ready..."
sleep 10

echo "==> Running DB migrations (in order)..."
for mig in "$BASE"/infra/db/migrations/*.sql; do
  name=$(basename "$mig")
  echo "  -> $name"
  docker exec -i teen_postgres psql -U teen -d teen_db < "$mig" 2>/dev/null || echo "     ($name may already be applied)"
done

echo "==> Starting services with PM2..."
cd "$BASE"
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo ""
echo "==> All services started!"
echo "  Run: pm2 status"
echo "  Logs: pm2 logs teen-auth --lines 50"
echo ""
echo "  Services running:"
echo "    Auth:         http://game.myonlinejoker.com/api/auth/health"
echo "    Wallet:       http://game.myonlinejoker.com/api/wallet/health"
echo "    Game Gateway: ws://game.myonlinejoker.com/socket.io/"
echo "    Aviator:      ws://game.myonlinejoker.com/aviator/"
echo "    Admin Panel:  http://game.myonlinejoker.com/admin/"
