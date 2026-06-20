#!/bin/bash
# Run this ONCE on a fresh Ubuntu 22.04 VPS as root
set -e

echo "==> Updating system..."
apt-get update && apt-get upgrade -y

echo "==> Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> Installing Go 1.22..."
wget -q https://go.dev/dl/go1.22.5.linux-amd64.tar.gz
rm -rf /usr/local/go && tar -C /usr/local -xzf go1.22.5.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile.d/go.sh
export PATH=$PATH:/usr/local/go/bin

echo "==> Installing Docker and Docker Compose..."
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Installing Nginx..."
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Installing PM2..."
npm install -g pm2 tsx typescript

echo "==> Creating project directory..."
mkdir -p /opt/teen
chmod 755 /opt/teen

echo "==> Setting up firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Bootstrap complete!"
echo ""
echo "Next steps:"
echo "  1. Clone repo: cd /opt/teen && git clone https://github.com/rahul1431/teen.git ."
echo "  2. Start DB: docker compose up -d"
echo "  3. Copy .env files and run deploy-services.sh"
