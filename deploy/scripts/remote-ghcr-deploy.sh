#!/usr/bin/env bash
# Remote GHCR deploy entrypoint (invoked over SSH from GitHub Actions).
# Required env: BACKEND_IMAGE, NGINX_IMAGE
# Optional: APP_BASE, SKIP_MIGRATE, GHCR_TOKEN, GHCR_USER, RUN_BACKUP=true, VERIFY_BACKUP=true
# Optional QA: PUBLIC_BASE_URL / AWS_PUBLIC_URL (sync SuperTokens+CORS), ENSURE_SMOKE_USERS=true, SMOKE_PIN
set -euo pipefail

# Empty string must not win over the default (secret may be set but blank).
if [ -z "${APP_BASE:-}" ]; then
  APP_BASE="/opt/zedral"
fi
: "${BACKEND_IMAGE:?BACKEND_IMAGE required}"
: "${NGINX_IMAGE:?NGINX_IMAGE required}"
: "${SKIP_MIGRATE:=false}"
: "${RUN_BACKUP:=false}"
: "${VERIFY_BACKUP:=false}"
: "${ENSURE_SMOKE_USERS:=false}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANDIDATE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Prefer APP_BASE checkout if present (ops layout)
if [ -f "${APP_BASE}/deploy/lib/common.sh" ]; then
  CANDIDATE_ROOT="${APP_BASE}"
elif [ -f "${APP_BASE}/$(basename "${CANDIDATE_ROOT}")/deploy/lib/common.sh" ]; then
  CANDIDATE_ROOT="${APP_BASE}/$(basename "${CANDIDATE_ROOT}")"
fi

# shellcheck source=../lib/common.sh
# common.sh resets REPO_ROOT/ENV_FILE — re-apply after source.
source "${CANDIDATE_ROOT}/deploy/lib/common.sh"

REPO_ROOT="${CANDIDATE_ROOT}"
COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.prod.yml"
ENV_FILE="${REPO_ROOT}/deploy/.env"
export APP_BASE REPO_ROOT COMPOSE_FILE ENV_FILE

require_docker
# Ensure ENV_FILE exists before domain sync (validate also heals/loads it).
[ -f "${ENV_FILE}" ] || die "Missing ${ENV_FILE}. On the server: cp deploy/.env.production.example deploy/.env && edit secrets."
# Prefer browser public URL over stale EIP / example.com in deploy/.env (SuperTokens cookie host).
sync_public_origin
validate_env_file

if [ "${RUN_BACKUP}" = "true" ]; then
  log "Pre-deploy PostgreSQL backup..."
  bash "${REPO_ROOT}/deploy/scripts/backup-db.sh"
  if [ "${VERIFY_BACKUP}" = "true" ]; then
    log "Verifying backup archive..."
    bash "${REPO_ROOT}/deploy/scripts/verify-backup.sh"
  fi
fi

# Checkpoint current images before switching (enables rollback-images.sh)
if [ -f "${REPO_ROOT}/deploy/.last-good-images" ]; then
  cp "${REPO_ROOT}/deploy/.last-good-images" "${REPO_ROOT}/deploy/.previous-good-images"
fi

export BACKEND_IMAGE NGINX_IMAGE SKIP_MIGRATE
run_stack_deploy
verify_deployment_health
# QA: seed badge 3000 then prove /auth/badge-pin accepts SMOKE_* (fatal — smoke cannot pass otherwise).
ensure_login_profiles
assert_smoke_badge_login
assert_public_auth_routes
record_successful_deploy
log "remote-ghcr-deploy finished OK"
