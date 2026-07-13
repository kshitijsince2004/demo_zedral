#!/usr/bin/env bash
# Remote GHCR deploy entrypoint (invoked over SSH from GitHub Actions).
# Required env: BACKEND_IMAGE, NGINX_IMAGE
# Optional: APP_BASE, SKIP_MIGRATE, GHCR_TOKEN, GHCR_USER, RUN_BACKUP=true, VERIFY_BACKUP=true
set -euo pipefail

# Empty string must not win over the default (secret may be set but blank).
if [ -z "${APP_BASE:-}" ]; then
  APP_BASE="/opt/zedralv2"
fi
: "${BACKEND_IMAGE:?BACKEND_IMAGE required}"
: "${NGINX_IMAGE:?NGINX_IMAGE required}"
: "${SKIP_MIGRATE:=false}"
: "${RUN_BACKUP:=false}"
: "${VERIFY_BACKUP:=false}"

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
record_successful_deploy
log "remote-ghcr-deploy finished OK"
