#!/usr/bin/env bash
# One-shot: install workstation SSH key + run the full-fleet deploy.
# On the VPS:  cd /opt/teen-prod && git pull && bash infra/deploy/go.sh
#
# REPO was /opt/teen until 2026-07-29 — that directory isn't a git
# checkout and nothing PM2 runs is served from it (every ecosystem.config.js
# app's cwd is under /opt/teen-prod/services). See docs/infra/deploy-pipeline.md.
set -euo pipefail

REPO=/opt/teen-prod
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

echo "==> Run full-fleet deploy"
bash "$REPO/infra/deploy/deploy-all-services.sh"
