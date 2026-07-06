#!/usr/bin/env bash
# One-shot: install workstation SSH key + run the tip/gifts/bot-fill deploy.
# On the VPS:  cd /opt/teen && git pull && bash infra/deploy/go.sh
set -euo pipefail

REPO=/opt/teen
cd "$REPO"

echo "==> Install workstation SSH key for root"
mkdir -p /root/.ssh
chmod 700 /root/.ssh
# Replace any broken pasted lines with the clean key from the repo.
grep -v "gamezone-vps" /root/.ssh/authorized_keys 2>/dev/null > /tmp/ak || true
cat "$REPO/infra/deploy/rahul-workstation.pub" >> /tmp/ak
mv /tmp/ak /root/.ssh/authorized_keys
chown -R root:root /root/.ssh
chmod 600 /root/.ssh/authorized_keys
echo "    key installed ($(wc -l < /root/.ssh/authorized_keys) key(s) total)"

echo "==> Run release deploy"
bash "$REPO/infra/deploy/deploy-tip-gifts-botfill.sh"
