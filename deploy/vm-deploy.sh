#!/usr/bin/env bash
# GitHub Actions / CI entrypoint — idempotent VM deploy (bootstrap + sync + compose + health).
# Does NOT modify host SSL certificates or Let's Encrypt configuration.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Windows editors may save CRLF; bash on Linux treats "pipefail\r" as invalid.
normalize_lf() {
  local f
  for f in "$@"; do
    [ -f "$f" ] && sed -i 's/\r$//' "$f"
  done
}
normalize_lf "${SCRIPT_DIR}/vm-deploy.sh" "${SCRIPT_DIR}/lib/common.sh" "${SCRIPT_DIR}/deploy.sh" "${SCRIPT_DIR}/rollback.sh"

# When fetched via curl into /tmp, bootstrap via common.sh then re-exec from the on-disk repo.
if [ ! -f "${SCRIPT_DIR}/lib/common.sh" ]; then
  : "${APP_BASE:=/opt/zedralv2}"
  : "${GITHUB_REPO:=kshitijsince2004/hsl_zedral}"
  : "${DEPLOY_REF:=main}"
  : "${SKIP_MIGRATE:=${SKIP_MIGRATE:-false}}"

  _repo_name="${GITHUB_REPO##*/}"
  for _candidate in \
    "${APP_BASE}" \
    "${APP_BASE}/${_repo_name}" \
    "${APP_BASE}/ZedralV2.1" \
    "${APP_BASE}/ZedralV2"; do
    if [ -f "${_candidate}/deploy/lib/common.sh" ]; then
      exec env APP_BASE="${APP_BASE}" GITHUB_REPO="${GITHUB_REPO}" \
        DEPLOY_REF="${DEPLOY_REF}" SKIP_MIGRATE="${SKIP_MIGRATE}" \
        GIT_DEPLOY_TOKEN="${GIT_DEPLOY_TOKEN:-}" \
        bash "${_candidate}/deploy/vm-deploy.sh"
    fi
  done

  echo "==> Bootstrapping repository (first deploy)…"
  REF="${DEPLOY_REF}"
  FETCH_BASE="https://raw.githubusercontent.com/${GITHUB_REPO}/${REF}/deploy"
  COMMON_TMP="/tmp/zedral-common.sh"
  CURL_OPTS=(-fsSL)
  if [ -n "${GIT_DEPLOY_TOKEN:-}" ]; then
    CURL_OPTS+=(-H "Authorization: token ${GIT_DEPLOY_TOKEN}")
  fi
  curl "${CURL_OPTS[@]}" "${FETCH_BASE}/lib/common.sh" -o "${COMMON_TMP}"
  # shellcheck source=/tmp/zedral-common.sh
  source "${COMMON_TMP}"

  bootstrap_repo_if_missing
  exec env APP_BASE="${APP_BASE}" GITHUB_REPO="${GITHUB_REPO}" \
    DEPLOY_REF="${DEPLOY_REF}" SKIP_MIGRATE="${SKIP_MIGRATE}" \
    GIT_DEPLOY_TOKEN="${GIT_DEPLOY_TOKEN:-}" \
    bash "${REPO_ROOT}/deploy/vm-deploy.sh"
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

  if [ "${SKIP_GIT_SYNC:-false}" = "true" ]; then
    log "SKIP_GIT_SYNC=true — using code synced from Actions checkout"
    log "Active commit: $(git -C "${REPO_ROOT}" rev-parse --short HEAD) — $(git -C "${REPO_ROOT}" log -1 --pretty=%s)"
  else
    git_sync_to_ref "${DEPLOY_REF}"
  fi
  run_stack_deploy
  verify_deployment_health
  record_successful_deploy
  log "Deploy finished successfully."
}

main "$@"
