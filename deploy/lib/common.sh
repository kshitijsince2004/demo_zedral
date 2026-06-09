#!/usr/bin/env bash
# Shared deployment helpers for ZedralV2 GCP VM (sourced, not executed directly).
set -euo pipefail

: "${APP_BASE:=/opt/zedralv2}"
: "${GITHUB_REPO:=kshitijsince2004/ZedralV2}"

REPO_ROOT=""
COMPOSE_FILE=""
ENV_FILE=""

log() { echo "==> $*"; }
die() { echo "::error::$*" >&2; exit 1; }

# Case A: /opt/zedralv2/.git
# Case B: /opt/zedralv2/ZedralV2/.git (clone into non-empty parent)
resolve_repo_root() {
  if [ -d "${APP_BASE}/.git" ]; then
    REPO_ROOT="${APP_BASE}"
  elif [ -d "${APP_BASE}/ZedralV2/.git" ]; then
    REPO_ROOT="${APP_BASE}/ZedralV2"
  else
    return 1
  fi
  export REPO_ROOT
  COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.prod.yml"
  ENV_FILE="${REPO_ROOT}/deploy/.env"
  export COMPOSE_FILE ENV_FILE
}

repo_clone_url() {
  if [ -n "${GCP_GIT_DEPLOY_TOKEN:-}" ]; then
    echo "https://x-access-token:${GCP_GIT_DEPLOY_TOKEN}@github.com/${GITHUB_REPO}.git"
  else
    echo "git@github.com:${GITHUB_REPO}.git"
  fi
}

bootstrap_repo_if_missing() {
  if resolve_repo_root 2>/dev/null; then
    log "Repository found at ${REPO_ROOT}"
    return 0
  fi

  log "First deploy: bootstrapping repository under ${APP_BASE}"
  sudo mkdir -p "${APP_BASE}"
  local clone_url
  clone_url="$(repo_clone_url)"

  if [ -d "${APP_BASE}" ] && [ "$(ls -A "${APP_BASE}" 2>/dev/null | wc -l)" -gt 0 ]; then
    log "Parent ${APP_BASE} is non-empty — cloning into ${APP_BASE}/ZedralV2"
    sudo git clone "${clone_url}" "${APP_BASE}/ZedralV2"
  else
    sudo git clone "${clone_url}" "${APP_BASE}"
  fi

  resolve_repo_root || die "Bootstrap clone completed but .git was not found under ${APP_BASE}"
  sudo chown -R "$(whoami):$(whoami)" "${REPO_ROOT}"

  if [ ! -f "${ENV_FILE}" ]; then
    cp "${REPO_ROOT}/deploy/.env.production.example" "${ENV_FILE}"
    log "Created ${ENV_FILE} from template — configure secrets before production traffic."
  fi
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Run deploy/bootstrap-gcp-vm.sh on the VM."
  docker --version
  if docker compose version >/dev/null 2>&1; then
    docker compose version
  elif docker-compose version >/dev/null 2>&1; then
    docker-compose version
  else
    die "Docker Compose plugin is not installed (docker compose / docker-compose)."
  fi
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
  else
    docker-compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
  fi
}

validate_env_file() {
  [ -f "${ENV_FILE}" ] || die "Missing ${ENV_FILE}. Copy deploy/.env.production.example to deploy/.env and configure secrets."

  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a

  local missing=()
  for key in JWT_SECRET DB_PASSWORD DB_USER DB_NAME; do
    if [ -z "${!key:-}" ]; then
      missing+=("$key")
    fi
  done

  if [ -z "${DATABASE_URL:-}" ] && [ -z "${DB_HOST:-}" ]; then
    missing+=("DATABASE_URL or DB_HOST")
  fi

  if [ "${#missing[@]}" -gt 0 ]; then
    die "deploy/.env is missing required variables: ${missing[*]}"
  fi

  case "${JWT_SECRET}" in
    CHANGE_ME*|change_me*) die "JWT_SECRET is still a placeholder in deploy/.env" ;;
  esac
  case "${DB_PASSWORD}" in
    CHANGE_ME*|change_me*) die "DB_PASSWORD is still a placeholder in deploy/.env" ;;
  esac

  log "Environment validation passed (SSL / host certificates are not modified by this deploy)."
}

save_deploy_checkpoint() {
  local sha
  sha="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  echo "${sha}" > "${REPO_ROOT}/deploy/.previous-good-sha"
  log "Saved rollback checkpoint: ${sha}"
}

git_sync_to_ref() {
  local ref="${1:?deploy ref required}"
  cd "${REPO_ROOT}"

  log "Fetching origin…"
  git fetch origin --prune

  if [[ "${ref}" =~ ^[0-9a-f]{40}$ ]]; then
    log "Resetting to CI-verified SHA ${ref}"
    git reset --hard "${ref}"
  else
    log "Resetting to origin/${ref}"
    git reset --hard "origin/${ref}"
  fi

  git clean -fd
  log "Active commit: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
}

run_stack_deploy() {
  cd "${REPO_ROOT}"

  if [ "${SKIP_MIGRATE:-false}" = "true" ]; then
    export RUN_MIGRATIONS=false
    log "SKIP_MIGRATE=true — migrations disabled for this deploy"
  fi

  log "Pulling pre-built images (if any)…"
  compose pull --ignore-pull-failures 2>/dev/null || compose pull || true

  log "Building and starting production stack…"
  compose up -d --build --remove-orphans
}

wait_for_container_running() {
  local name="$1"
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if docker inspect -f '{{.State.Running}}' "${name}" 2>/dev/null | grep -q true; then
      return 0
    fi
    sleep 3
  done
  die "Container ${name} is not running after deploy."
}

wait_for_container_healthy() {
  local name="$1"
  local status
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${name}" 2>/dev/null || echo missing)"
  if [ "${status}" = "none" ] || [ "${status}" = "missing" ]; then
    return 0
  fi
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    status="$(docker inspect -f '{{.State.Health.Status}}' "${name}" 2>/dev/null || echo missing)"
    if [ "${status}" = "healthy" ]; then
      return 0
    fi
    if [ "${status}" = "unhealthy" ]; then
      die "Container ${name} reported unhealthy."
    fi
    sleep 6
  done
  die "Container ${name} did not become healthy in time (last status: ${status})."
}

verify_deployment_health() {
  local http_port="${HTTP_PORT:-80}"
  log "Container status:"
  compose ps || true
  docker ps --filter "name=zedral-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

  for c in zedral-db zedral-backend zedral-nginx; do
    wait_for_container_running "${c}"
  done

  wait_for_container_healthy zedral-db
  wait_for_container_healthy zedral-backend

  log "HTTP health check via nginx (port ${http_port})…"
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if curl -fsS "http://127.0.0.1:${http_port}/health" | head -c 200; then
      echo ""
      log "Health check passed"
      return 0
    fi
    echo "Health attempt ${attempt}/6 failed — retrying in 10s…"
    sleep 10
  done

  die "Health check failed at http://127.0.0.1:${http_port}/health — inspect: compose logs backend nginx"
}

record_successful_deploy() {
  git -C "${REPO_ROOT}" rev-parse HEAD > "${REPO_ROOT}/deploy/.last-good-sha"
  log "Recorded successful deploy SHA in deploy/.last-good-sha"
}
