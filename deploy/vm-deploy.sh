#!/usr/bin/env bash
# GitHub Actions / CI entrypoint — idempotent VM deploy (bootstrap + sync + compose + health).
# Does NOT modify host SSL certificates or Let's Encrypt configuration.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# When fetched via curl into /tmp, re-exec from the on-disk repository copy.
if [ ! -f "${SCRIPT_DIR}/lib/common.sh" ]; then
  : "${APP_BASE:=/opt/zedralv2}"
  : "${GITHUB_REPO:=kshitijsince2004/ZedralV2}"

  if [ -d "${APP_BASE}/deploy/lib/common.sh" ]; then
    exec env APP_BASE="${APP_BASE}" GITHUB_REPO="${GITHUB_REPO}" \
      DEPLOY_REF="${DEPLOY_REF:-main}" SKIP_MIGRATE="${SKIP_MIGRATE:-false}" \
      GCP_GIT_DEPLOY_TOKEN="${GCP_GIT_DEPLOY_TOKEN:-}" \
      bash "${APP_BASE}/deploy/vm-deploy.sh"
  elif [ -d "${APP_BASE}/ZedralV2/deploy/lib/common.sh" ]; then
    exec env APP_BASE="${APP_BASE}" GITHUB_REPO="${GITHUB_REPO}" \
      DEPLOY_REF="${DEPLOY_REF:-main}" SKIP_MIGRATE="${SKIP_MIGRATE:-false}" \
      GCP_GIT_DEPLOY_TOKEN="${GCP_GIT_DEPLOY_TOKEN:-}" \
      bash "${APP_BASE}/ZedralV2/deploy/vm-deploy.sh"
  fi

  echo "==> Bootstrapping repository (first deploy)…"
  sudo mkdir -p "${APP_BASE}"
  CLONE_URL="git@github.com:${GITHUB_REPO}.git"
  if [ -n "${GCP_GIT_DEPLOY_TOKEN:-}" ]; then
    CLONE_URL="https://x-access-token:${GCP_GIT_DEPLOY_TOKEN}@github.com/${GITHUB_REPO}.git"
  fi

  if [ -d "${APP_BASE}" ] && [ "$(ls -A "${APP_BASE}" 2>/dev/null | wc -l)" -gt 0 ]; then
    sudo git clone "${CLONE_URL}" "${APP_BASE}/ZedralV2"
    TARGET="${APP_BASE}/ZedralV2/deploy/vm-deploy.sh"
  else
    sudo git clone "${CLONE_URL}" "${APP_BASE}"
    TARGET="${APP_BASE}/deploy/vm-deploy.sh"
  fi
  sudo chown -R "$(whoami):$(whoami)" "${APP_BASE}"
  exec env APP_BASE="${APP_BASE}" GITHUB_REPO="${GITHUB_REPO}" \
    DEPLOY_REF="${DEPLOY_REF:-main}" SKIP_MIGRATE="${SKIP_MIGRATE:-false}" \
    GCP_GIT_DEPLOY_TOKEN="${GCP_GIT_DEPLOY_TOKEN:-}" \
    bash "${TARGET}"
fi

# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

: "${APP_BASE:=/opt/zedralv2}"
: "${DEPLOY_REF:=main}"
: "${SKIP_MIGRATE:=false}"

main() {
  log "ZedralV2 VM deploy starting (APP_BASE=${APP_BASE}, DEPLOY_REF=${DEPLOY_REF})"
  require_docker
  bootstrap_repo_if_missing
  resolve_repo_root || die "Could not resolve repository root under ${APP_BASE}"

  cd "${REPO_ROOT}"
  validate_env_file

  if [ -f "${REPO_ROOT}/deploy/.last-good-sha" ]; then
    cp "${REPO_ROOT}/deploy/.last-good-sha" "${REPO_ROOT}/deploy/.previous-good-sha"
  fi

  git_sync_to_ref "${DEPLOY_REF}"
  run_stack_deploy
  verify_deployment_health
  record_successful_deploy
  log "Deploy finished successfully."
}

main "$@"
