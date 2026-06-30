#!/usr/bin/env bash
# Nginx config protection — runs every 30 minutes via cron.
# HestiaCP can overwrite nginx.conf_api on any panel action.
# This script re-applies hestia-proxy.conf if the content drifts.
#
# Cron setup (run as root):
#   */30 * * * * /opt/teen/infra/scripts/nginx-protect.sh >> /var/log/nginx-protect.log 2>&1

BASE=/opt/teen
HESTIA_DIR="/home/admin/conf/web/game.myonlinejoker.com"
SOURCE="${BASE}/infra/nginx/hestia-proxy.conf"

if [[ ! -d "$HESTIA_DIR" ]]; then
  exit 0  # not a HestiaCP server
fi

for TARGET in "${HESTIA_DIR}/nginx.conf_api" "${HESTIA_DIR}/nginx.ssl.conf_api"; do
  if ! diff -q "$SOURCE" "$TARGET" > /dev/null 2>&1; then
    echo "$(date '+%Y-%m-%d %H:%M') nginx conf drifted — restoring ${TARGET}"
    cp "$SOURCE" "$TARGET"
    CHANGED=1
  fi
done

if [[ -n "$CHANGED" ]]; then
  nginx -t && systemctl reload nginx && echo "nginx reloaded"
fi
