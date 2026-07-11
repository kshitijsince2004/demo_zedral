#!/usr/bin/env bash
# Roll back to the previous successful deploy.
# Prefers GHCR image checkpoint; falls back to git SHA rebuild path (legacy).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "${ROOT_DIR}/deploy/lib/common.sh"

if [ -d "${ROOT_DIR}/.git" ]; then
  if [ "$(basename "${ROOT_DIR}")" = "ZedralV2" ]; then
    export APP_BASE="${APP_BASE:-$(dirname "${ROOT_DIR}")}"
  else
    export APP_BASE="${APP_BASE:-${ROOT_DIR}}"
  fi
else
  export APP_BASE="${APP_BASE:-$(dirname "${ROOT_DIR}")}"
fi

ROLLBACK_SHA="${1:-}"

require_docker
resolve_repo_root || die "Could not resolve repository root"

# Preferred path: previous GHCR images (no rebuild on server)
if [ -z "${ROLLBACK_SHA}" ] && [ -f "${REPO_ROOT}/deploy/.previous-good-images" ]; then
  log "Using image-based rollback (.previous-good-images)"
  validate_env_file
  rollback_to_previous_images
  exit 0
fi

if [ -z "${ROLLBACK_SHA}" ]; then
  if [ -f "${REPO_ROOT}/deploy/.previous-good-sha" ]; then
    ROLLBACK_SHA="$(cat "${REPO_ROOT}/deploy/.previous-good-sha")"
  elif [ -f "${REPO_ROOT}/deploy/.last-good-sha" ]; then
    die "Only one deploy recorded. Pass an explicit SHA: bash deploy/rollback.sh <sha>"
  else
    die "No rollback checkpoint found. Pass an explicit SHA or ensure .previous-good-images exists."
  fi
fi

die "Git-SHA rollback requires rebuilding on the host, which is disabled. Set BACKEND_IMAGE/NGINX_IMAGE for that SHA from GHCR, or use deploy/scripts/rollback-images.sh"
