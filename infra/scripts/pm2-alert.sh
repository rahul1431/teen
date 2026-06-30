#!/usr/bin/env bash
# PM2 crash alerter — runs every 5 minutes via cron.
# Sends a Telegram message when any PM2 process is stopped/errored.
#
# Setup:
#   1. Create a Telegram bot via @BotFather → get BOT_TOKEN
#   2. Message the bot once, then get CHAT_ID:
#      curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
#   3. Edit the two vars below and add to crontab:
#      crontab -e
#      */5 * * * * /opt/teen/infra/scripts/pm2-alert.sh >> /var/log/pm2-alert.log 2>&1

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${TELEGRAM_CHAT_ID:-}"
STATE_FILE="/tmp/pm2-alert-state"

send_telegram() {
  local msg="$1"
  if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
    echo "[pm2-alert] No Telegram credentials — log only: $msg"
    return
  fi
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    -d "text=${msg}" \
    -d "parse_mode=HTML" > /dev/null
}

# Get all stopped/errored processes
PROBLEMS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    procs = json.load(sys.stdin)
    bad = [p['name'] for p in procs if p['pm2_env']['status'] not in ('online', 'launching')]
    print('\n'.join(bad))
except: pass
")

if [[ -z "$PROBLEMS" ]]; then
  # All good — clear state file so next alert fires fresh if something breaks
  rm -f "$STATE_FILE"
  exit 0
fi

# Deduplicate: only alert once per unique set of down processes
HASH=$(echo "$PROBLEMS" | md5sum | cut -d' ' -f1)
PREV_HASH=$(cat "$STATE_FILE" 2>/dev/null)

if [[ "$HASH" == "$PREV_HASH" ]]; then
  exit 0  # already alerted for this exact set
fi

echo "$HASH" > "$STATE_FILE"

HOSTNAME=$(hostname)
DATE=$(date '+%Y-%m-%d %H:%M UTC')
MSG="🚨 <b>PM2 ALERT — ${HOSTNAME}</b>%0A${DATE}%0A%0ADown processes:%0A"
while IFS= read -r name; do
  MSG="${MSG}  • ${name}%0A"
  echo "[pm2-alert] DOWN: $name"
done <<< "$PROBLEMS"
MSG="${MSG}%0ARun: pm2 restart all"

send_telegram "$MSG"
