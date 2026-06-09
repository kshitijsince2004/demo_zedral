#!/usr/bin/env bash
# Manual deploy on the VM — sync to origin/main and restart the stack.
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

export DEPLOY_REF="${DEPLOY_REF:-main}"
export SKIP_MIGRATE="${SKIP_MIGRATE:-false}"

require_docker
resolve_repo_root || die "Not a git repository. Expected ${APP_BASE}/.git or ${APP_BASE}/ZedralV2/.git"
validate_env_file

if [ -f "${REPO_ROOT}/deploy/.last-good-sha" ]; then
  cp "${REPO_ROOT}/deploy/.last-good-sha" "${REPO_ROOT}/deploy/.previous-good-sha"
fi

git_sync_to_ref "${DEPLOY_REF}"
run_stack_deploy
verify_deployment_health
record_successful_deploy

log "Manual deploy complete."
