#!/usr/bin/env bash
# Manual / periodic rollback drill: prove checkpoint restore brings /health back.
# Usage (on QA or Factory box, from APP_DIR):
#   bash deploy/scripts/drill-rollback.sh
# Optional: DRILL_DRY_RUN=1 to only validate checkpoints exist.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "${SCRIPT_DIR}/../lib/common.sh"

REPO_ROOT="${APP_BASE:-/opt/zedral}"
COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.prod.yml"
ENV_FILE="${REPO_ROOT}/deploy/.env"
export APP_BASE REPO_ROOT COMPOSE_FILE ENV_FILE

require_docker
validate_env_file

PREV="${REPO_ROOT}/deploy/.previous-good-images"
LAST="${REPO_ROOT}/deploy/.last-good-images"

[ -f "${LAST}" ] || die "Missing ${LAST} — deploy at least once before drilling"
[ -f "${PREV}" ] || die "Missing ${PREV} — need two successful deploys to have a previous checkpoint"

log "Last-good checkpoint:"
cat "${LAST}"
log "Previous-good checkpoint:"
cat "${PREV}"

if [ "${DRILL_DRY_RUN:-0}" = "1" ]; then
  log "DRILL_DRY_RUN=1 — checkpoints OK, not switching images"
  exit 0
fi

log "Executing rollback-images.sh (restores previous-good)…"
bash "${REPO_ROOT}/deploy/scripts/rollback-images.sh"
log "Rollback drill complete — verify /health and re-deploy desired tag when done."
