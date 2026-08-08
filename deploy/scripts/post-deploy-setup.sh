#!/usr/bin/env bash
# One-time post-deploy: seed login users + print credentials.
# Run on EC2 after the stack is healthy.
#
# Usage:
#   cd /opt/zedral
#   SEED_PIN='5678' bash deploy/scripts/post-deploy-setup.sh
#
# Options:
#   SEED_MODE=profiles  — users + machines only (default, production)
#   SEED_MODE=admin     — full demo data (coils, PPC queue, shift logs)
#   SEED_PIN=....       — PIN for all seeded badges (default: 1234 — change in prod)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.prod.yml"
ENV_FILE="${REPO_ROOT}/deploy/.env"

[ -f "${ENV_FILE}" ] || { echo "Missing ${ENV_FILE}" >&2; exit 1; }

SEED_MODE="${SEED_MODE:-profiles}"
SEED_PIN="${SEED_PIN:-1234}"

  while IFS='=' read -r key value || [ -n "$key" ]; do
    key="$(echo -n "$key" | xargs)"
    key="${key#export }"
    if [[ -z "$key" ]] || [[ "$key" == \#* ]]; then continue; fi
    value="${value%$'\r'}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    export "$key=$value"
  done < "${ENV_FILE}"
HTTP_PORT="${HTTP_PORT:-80}"

echo "==> Health check…"
curl -fsS "http://127.0.0.1:${HTTP_PORT}/health" >/dev/null || {
  echo "ERROR: /health not reachable — start stack: bash deploy/deploy.sh"
  exit 1
}

echo "==> Seeding (${SEED_MODE})…"
case "${SEED_MODE}" in
  admin)
    # Prod image has no npm — node scripts map 1:1 to package.json seed:* entries.
    docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T \
      -e SEED_PIN="${SEED_PIN}" backend node scripts/seed-admin.mjs
    ;;
  profiles)
    docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T \
      -e SEED_PIN="${SEED_PIN}" backend node scripts/seed-login-profiles.mjs
    ;;
  *)
    echo "Unknown SEED_MODE=${SEED_MODE} (use profiles or admin)" >&2
    exit 1
    ;;
esac

PUBLIC_IP="$(curl -fsS --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
# shellcheck disable=SC1090
  while IFS='=' read -r key value || [ -n "$key" ]; do
    key="$(echo -n "$key" | xargs)"
    key="${key#export }"
    if [[ -z "$key" ]] || [[ "$key" == \#* ]]; then continue; fi
    value="${value%$'\r'}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    export "$key=$value"
  done < "${ENV_FILE}" 2>/dev/null || true
PUBLIC_URL="${PUBLIC_URL:-}"
if [ -z "${PUBLIC_URL}" ] && [ -n "${PUBLIC_DOMAIN:-}" ]; then
  PUBLIC_URL="https://${PUBLIC_DOMAIN}"
fi
PUBLIC_URL="${PUBLIC_URL:-http://${PUBLIC_IP:-YOUR_ELASTIC_IP}}"

echo ""
echo "=============================================="
echo "  Zedral login credentials"
echo "=============================================="
echo "  URL:  ${PUBLIC_URL}"
echo "  PIN:  ${SEED_PIN}  (all badges below)"
echo ""
echo "  Badge 1000  Plant Admin     → /admin/master-data"
echo "  Badge 2000  Line Supervisor"
echo "  Badge 3000  Shift Operator  → /operator"
echo "  Badge 4000  Machine Head    → /machine-head-dashboard"
echo "  Badge 5000  Plant Head      → /plant"
echo ""
echo "  Set a strong PIN: SEED_PIN='xxxx' bash deploy/scripts/post-deploy-setup.sh"
echo "  Open EC2 Security Group TCP 80 if URL is not reachable from your network."
echo "=============================================="
