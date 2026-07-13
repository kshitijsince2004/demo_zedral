#!/usr/bin/env bash
# Wait until ${BASE_URL}/health returns HTTP 200.
# Distinguishes Cloudflare 52x (CDN ↔ origin) from app-level failures.
#
# When run in GitHub Actions, writes:
#   rollback_safe=false  for Cloudflare 521–524 (do NOT roll back images)
#   rollback_safe=true   otherwise (app bug / auth / 5xx from origin)
#
# Usage:
#   BASE_URL=https://hsl.zedral.com bash deploy/scripts/wait-public-health.sh
set -euo pipefail

BASE_URL="${BASE_URL:?BASE_URL is required}"
BASE_URL="${BASE_URL%/}"
ATTEMPTS="${ATTEMPTS:-18}"
SLEEP_SECS="${SLEEP_SECS:-10}"

write_output() {
  local key="$1"
  local value="$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "${key}=${value}" >> "$GITHUB_OUTPUT"
  fi
}

write_output rollback_safe true
write_output failure_kind unknown

last_code="000"
body_snip=""

for i in $(seq 1 "${ATTEMPTS}"); do
  last_code="$(
    curl -sS -o /tmp/zedral-public-health.body -w '%{http_code}' \
      --connect-timeout 10 --max-time 25 \
      "${BASE_URL}/health" 2>/dev/null || echo "000"
  )"
  body_snip="$(head -c 160 /tmp/zedral-public-health.body 2>/dev/null || true)"

  if [ "${last_code}" = "200" ]; then
    echo "Public /health OK at ${BASE_URL}"
    echo "${body_snip}"
    write_output failure_kind none
    exit 0
  fi

  echo "Attempt ${i}/${ATTEMPTS}: HTTP ${last_code} from ${BASE_URL}/health"
  if [[ "${last_code}" =~ ^52[1-4]$ ]]; then
    echo "  (Cloudflare ${last_code} — origin not reachable via CDN yet)"
  fi
  sleep "${SLEEP_SECS}"
done

case "${last_code}" in
  521|522|523|524)
    write_output rollback_safe false
    write_output failure_kind cdn
    echo "::error::Cloudflare HTTP ${last_code} contacting ${BASE_URL}/health — CDN cannot reach origin."
    echo "::error::Local deploy /health can still pass. This is NOT a bad GHCR image; skip image rollback."
    echo "::error::Check: (1) AWS SG inbound TCP 80/443 open to Cloudflare IPs or 0.0.0.0/0"
    echo "::error::       (2) Cloudflare DNS A record → current EC2 Elastic IP"
    echo "::error::       (3) docker ps / curl http://127.0.0.1/health on the box"
    echo "::error::Body: ${body_snip}"
    exit 1
    ;;
esac

write_output rollback_safe true
write_output failure_kind app
echo "::error::Public /health failed after ${ATTEMPTS} attempts (last HTTP ${last_code})"
echo "::error::Body: ${body_snip}"
exit 1
