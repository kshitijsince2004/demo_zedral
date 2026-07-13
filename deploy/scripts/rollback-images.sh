#!/usr/bin/env bash
# Roll back to the previous GHCR image pair recorded in deploy/.previous-good-images.
# Restores the last known-good release/SHA tags (never rebuilds).
#
# Usage (on server):
#   export APP_BASE=/opt/zedralv2
#   bash deploy/scripts/rollback-images.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/common.sh
source "${ROOT_DIR}/deploy/lib/common.sh"

export APP_BASE="${APP_BASE:-${ROOT_DIR}}"
resolve_repo_root || {
  REPO_ROOT="${ROOT_DIR}"
  COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.prod.yml"
  ENV_FILE="${REPO_ROOT}/deploy/.env"
  export REPO_ROOT COMPOSE_FILE ENV_FILE
}

require_docker
validate_env_file

PREV="${REPO_ROOT}/deploy/.previous-good-images"
if [ ! -f "${PREV}" ]; then
  log "No previous image checkpoint at ${PREV} — nothing to roll back to."
  log "This is expected on the FIRST deploy (no known-good release yet). Skipping rollback."
  exit 0
fi

log "Previous image checkpoint:"
cat "${PREV}" || true

rollback_to_previous_images
