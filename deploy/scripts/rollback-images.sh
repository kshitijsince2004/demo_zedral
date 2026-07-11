#!/usr/bin/env bash
# Roll back to previous GHCR image pair recorded in deploy/.previous-good-images
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
rollback_to_previous_images
