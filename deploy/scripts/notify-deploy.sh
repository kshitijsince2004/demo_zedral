#!/usr/bin/env bash
# Post JSON status to Slack or Discord webhook (DEPLOY_WEBHOOK_URL).
# Usage: notify-deploy.sh <started|success|failed|rollback> "message"
set -euo pipefail

STATUS="${1:?status required}"
MESSAGE="${2:-}"
WEBHOOK="${DEPLOY_WEBHOOK_URL:-}"

if [ -z "${WEBHOOK}" ]; then
  echo "DEPLOY_WEBHOOK_URL not set — skip notify (${STATUS})"
  exit 0
fi

COLOR="3447003"
case "${STATUS}" in
  started) COLOR="3447003" ;;
  success) COLOR="3066993" ;;
  failed) COLOR="15158332" ;;
  rollback) COLOR="15105570" ;;
esac

TITLE="Zedral deploy: ${STATUS}"
BODY="${MESSAGE}"

# Discord-compatible + Slack-compatible payload (Discord ignores unused fields)
PAYLOAD=$(printf '{"content":"%s — %s","text":"%s — %s","embeds":[{"title":"%s","description":"%s","color":%s}]}' \
  "${TITLE}" "${BODY}" "${TITLE}" "${BODY}" "${TITLE}" "${BODY}" "${COLOR}")

curl -fsS -H 'Content-Type: application/json' -d "${PAYLOAD}" "${WEBHOOK}" >/dev/null || true
echo "Notified: ${STATUS}"
