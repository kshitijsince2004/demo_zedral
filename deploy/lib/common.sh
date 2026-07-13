#!/usr/bin/env bash
# Shared deployment helpers for ZedralV2 AWS EC2 VM (sourced, not executed directly).
set -euo pipefail

: "${APP_BASE:=/opt/zedral}"
: "${GITHUB_REPO:=kshitijsince2004/hsl_zedral}"

REPO_ROOT=""
COMPOSE_FILE=""
ENV_FILE=""

log() { echo "==> $*"; }
die() { echo "::error::$*" >&2; exit 1; }

repo_basename() {
  echo "${GITHUB_REPO##*/}"
}

# Case A: /opt/zedral/.git
# Case B: /opt/zedral/<repo>/.git (clone into non-empty parent)
# Legacy: ZedralV2 / ZedralV2.1 nested folders from earlier bootstraps
resolve_repo_root() {
  local candidate name
  name="$(repo_basename)"
  for candidate in \
    "${APP_BASE}" \
    "${APP_BASE}/${name}" \
    "${APP_BASE}/ZedralV2.1" \
    "${APP_BASE}/ZedralV2"; do
    if [ -d "${candidate}/.git" ]; then
      REPO_ROOT="${candidate}"
      export REPO_ROOT
      COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.prod.yml"
      ENV_FILE="${REPO_ROOT}/deploy/.env"
      export COMPOSE_FILE ENV_FILE
      return 0
    fi
  done
  return 1
}

# Idempotent clone: reuse existing .git, re-init partial dirs, or fresh clone.
bootstrap_clone_into() {
  local clone_url="$1"
  local target="$2"

  if [ -d "${target}/.git" ]; then
    log "Git repository already present at ${target}"
    return 0
  fi

  if [ -d "${target}" ]; then
    if [ -z "$(ls -A "${target}" 2>/dev/null)" ]; then
      sudo rmdir "${target}" 2>/dev/null || sudo rm -rf "${target}"
    else
      log "Directory ${target} exists without .git — syncing from origin"
      sudo mkdir -p "${target}"
      sudo chown -R "$(whoami):$(whoami)" "${target}"
      git -C "${target}" init
      git -C "${target}" remote add origin "${clone_url}" 2>/dev/null \
        || git -C "${target}" remote set-url origin "${clone_url}"
      git -C "${target}" fetch origin --prune
      git -C "${target}" checkout -B main "origin/main"
      git -C "${target}" reset --hard "origin/main"
      return 0
    fi
  fi

  sudo mkdir -p "$(dirname "${target}")"
  sudo git clone "${clone_url}" "${target}"
}

repo_clone_url() {
  if [ -n "${GIT_DEPLOY_TOKEN:-}" ]; then
    echo "https://x-access-token:${GIT_DEPLOY_TOKEN}@github.com/${GITHUB_REPO}.git"
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
  local clone_url target name legacy
  clone_url="$(repo_clone_url)"
  name="$(repo_basename)"

  if [ -d "${APP_BASE}" ] && [ "$(ls -A "${APP_BASE}" 2>/dev/null | wc -l)" -gt 0 ]; then
    target="${APP_BASE}/${name}"
    for legacy in ZedralV2 ZedralV2.1 "${name}"; do
      if [ -d "${APP_BASE}/${legacy}" ]; then
        target="${APP_BASE}/${legacy}"
        log "Parent ${APP_BASE} is non-empty — using existing path ${target}"
        break
      fi
    done
    if [ "${target}" = "${APP_BASE}/${name}" ] && [ ! -d "${target}" ]; then
      log "Parent ${APP_BASE} is non-empty — cloning into ${target}"
    fi
  else
    target="${APP_BASE}"
  fi

  bootstrap_clone_into "${clone_url}" "${target}"

  resolve_repo_root || die "Bootstrap clone completed but .git was not found under ${APP_BASE}"
  sudo chown -R "$(whoami):$(whoami)" "${REPO_ROOT}"

  if [ ! -f "${ENV_FILE}" ]; then
    cp "${REPO_ROOT}/deploy/.env.production.example" "${ENV_FILE}"
    log "Created ${ENV_FILE} from template — configure secrets before production traffic."
  fi
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Run deploy/bootstrap-aws-vm.sh on the VM."
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
  [ -n "${ENV_FILE:-}" ] || die "ENV_FILE is unset (internal deploy bug — REPO_ROOT was empty)."
  [ -f "${ENV_FILE}" ] || die "Missing ${ENV_FILE}. On the server: cp deploy/.env.production.example deploy/.env && edit secrets (never commit .env)."

  while IFS='=' read -r key value || [ -n "$key" ]; do
    key="$(echo -n "$key" | xargs)"
    key="${key#export }"
    if [[ -z "$key" ]] || [[ "$key" == \#* ]]; then
      continue
    fi
    value="${value%$'\r'}"
    # Strip surrounding quotes if present
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    export "$key=$value"
  done < "${ENV_FILE}"

  local missing=()
  for key in JWT_SECRET DB_PASSWORD DB_USER DB_NAME TENANT_ID; do
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
  if [ "${#JWT_SECRET}" -lt 32 ]; then
    die "JWT_SECRET must be at least 32 characters for production"
  fi
  if [ "${AUTH_STRICT:-true}" != "true" ]; then
    die "AUTH_STRICT must be true for production deploy"
  fi
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

  if [ -n "${GIT_DEPLOY_TOKEN:-}" ]; then
    git remote set-url origin "https://x-access-token:${GIT_DEPLOY_TOKEN}@github.com/${GITHUB_REPO}.git"
  fi

  log "Fetching origin…"
  if ! git fetch origin --prune 2>&1; then
    die "git fetch failed — for self-hosted deploy use Actions checkout + SKIP_GIT_SYNC=true, or set AWS_GIT_DEPLOY_TOKEN with repo Contents read access"
  fi

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

  [ -n "${BACKEND_IMAGE:-}" ] || die "BACKEND_IMAGE is required (GHCR pull-only deploy — never build on host)"
  [ -n "${NGINX_IMAGE:-}" ] || die "NGINX_IMAGE is required (GHCR pull-only deploy — never build on host)"

  upsert_env_var BACKEND_IMAGE "${BACKEND_IMAGE}"
  upsert_env_var NGINX_IMAGE "${NGINX_IMAGE}"
  if [ -n "${GHCR_TOKEN:-}" ] && [ -n "${GHCR_USER:-}" ]; then
    echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
  fi
  log "Pulling pre-built images (Build Once → Deploy Many)…"
  log "  backend: ${BACKEND_IMAGE}"
  log "  nginx:   ${NGINX_IMAGE}"
  compose pull backend nginx
  compose up -d --remove-orphans --no-build
}

upsert_env_var() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  if [ -f "${ENV_FILE}" ] && grep -q "^${key}=" "${ENV_FILE}"; then
    # Use | delimiter — image refs contain /
    sed "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}" > "${tmp}"
    mv "${tmp}" "${ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

save_image_checkpoint() {
  local file="${REPO_ROOT}/deploy/.last-good-images"
  local prev="${REPO_ROOT}/deploy/.previous-good-images"
  if [ -f "${file}" ]; then
    cp "${file}" "${prev}"
  fi
  {
    echo "BACKEND_IMAGE=${BACKEND_IMAGE}"
    echo "NGINX_IMAGE=${NGINX_IMAGE}"
    echo "RECORDED_AT=$(date -Is)"
  } > "${file}"
  log "Saved image checkpoint → ${file}"
}

rollback_to_previous_images() {
  local prev="${REPO_ROOT}/deploy/.previous-good-images"
  [ -f "${prev}" ] || die "No previous image checkpoint at ${prev}"
  # shellcheck disable=SC1090
  set -a
  source "${prev}"
  set +a
  [ -n "${BACKEND_IMAGE:-}" ] && [ -n "${NGINX_IMAGE:-}" ] || die "Previous checkpoint missing image refs"
  log "Rolling back to previous release / image pair…"
  log "  backend: ${BACKEND_IMAGE}"
  log "  nginx:   ${NGINX_IMAGE}"
  if [ -n "${RECORDED_AT:-}" ]; then
    log "  previous checkpoint recorded at: ${RECORDED_AT}"
  fi
  export BACKEND_IMAGE NGINX_IMAGE
  SKIP_MIGRATE=true run_stack_deploy
  verify_deployment_health
  save_image_checkpoint
  log "Image rollback complete — previous tag restored."
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
  git -C "${REPO_ROOT}" rev-parse HEAD > "${REPO_ROOT}/deploy/.last-good-sha" 2>/dev/null || true
  if [ -n "${BACKEND_IMAGE:-}" ] && [ -n "${NGINX_IMAGE:-}" ]; then
    save_image_checkpoint
  fi
  log "Recorded successful deploy SHA"
}
