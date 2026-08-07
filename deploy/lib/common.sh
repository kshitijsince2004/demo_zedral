#!/usr/bin/env bash
# Shared deployment helpers for ZedralV2 AWS EC2 VM (sourced, not executed directly).
set -euo pipefail

: "${APP_BASE:=/opt/zedral}"

# Defaults in case the calling script doesn't export them
REPO_ROOT="${REPO_ROOT:-$APP_BASE}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/deploy/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/deploy/.env}"

log() { echo "==> $*"; }
die() { echo "::error::$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed."
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

auto_heal_env_file() {
  [ -f "${ENV_FILE}" ] || return 0
  
  if ! grep -q "^SUPERTOKENS_API_KEY=" "${ENV_FILE}"; then
    local new_key
    new_key="$(openssl rand -hex 32)"
    printf '\n# Auto-healed by deploy script\nSUPERTOKENS_API_KEY=%s\n' "${new_key}" >> "${ENV_FILE}"
    log "Auto-generated missing SUPERTOKENS_API_KEY in .env"
  fi

  if ! grep -q "^API_DOMAIN=" "${ENV_FILE}" || ! grep -q "^WEBSITE_DOMAIN=" "${ENV_FILE}"; then
    local public_ip
    public_ip="$(curl -fsS --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
    
    if [ -z "${public_ip}" ]; then
      log "Could not auto-fill from EC2 metadata (not an EC2 instance or metadata unreachable)."
      log "Falling back to primary local IP address..."
      public_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1 2>/dev/null | awk '{print $(NF-2);exit}' || true)"
    fi

    if [ -n "${public_ip}" ]; then
      if ! grep -q "^API_DOMAIN=" "${ENV_FILE}"; then
        printf 'API_DOMAIN=http://%s\n' "${public_ip}" >> "${ENV_FILE}"
        log "Auto-filled API_DOMAIN=http://${public_ip} in .env"
      fi
      if ! grep -q "^WEBSITE_DOMAIN=" "${ENV_FILE}"; then
        printf 'WEBSITE_DOMAIN=http://%s\n' "${public_ip}" >> "${ENV_FILE}"
        log "Auto-filled WEBSITE_DOMAIN=http://${public_ip} in .env"
      fi
    else
      log "Could not determine any IP address for API_DOMAIN/WEBSITE_DOMAIN auto-fill."
    fi
  fi
}

validate_env_file() {
  [ -n "${ENV_FILE:-}" ] || die "ENV_FILE is unset."
  [ -f "${ENV_FILE}" ] || die "Missing ${ENV_FILE}. On the server: cp deploy/.env.production.example deploy/.env && edit secrets."

  auto_heal_env_file

  while IFS='=' read -r key value || [ -n "$key" ]; do
    key="$(echo -n "$key" | xargs)"
    key="${key#export }"
    if [[ -z "$key" ]] || [[ "$key" == \#* ]]; then
      continue
    fi
    value="${value%$'\r'}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    
    # Only export if not already populated in the environment.
    # This prevents stale .env files from overriding fresh tags from CI/CD runner.
    if [ -z "${!key:-}" ]; then
      export "$key=$value"
    fi
  done < "${ENV_FILE}"

  local missing=()
  for key in JWT_SECRET DB_PASSWORD DB_USER DB_NAME TENANT_ID SUPERTOKENS_API_KEY API_DOMAIN WEBSITE_DOMAIN; do
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

  # DB_USER in deploy/.env must be bootstrap owner, not the RLS app role.
  local app_role="${DB_APP_USER:-m1_app}"
  if [ "${DB_USER}" = "${app_role}" ]; then
    die "DB_USER=${DB_USER} is the app/RLS role — set DB_USER to the bootstrap owner (e.g. m1_user) and DB_APP_USER=${app_role}"
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
  case "${SUPERTOKENS_API_KEY}" in
    CHANGE_ME*|change_me*) die "SUPERTOKENS_API_KEY is still a placeholder in deploy/.env" ;;
  esac

  log "Environment validation passed (bootstrap DB_USER=${DB_USER})."
}

upsert_env_var() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  if [ -f "${ENV_FILE}" ] && grep -q "^${key}=" "${ENV_FILE}"; then
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
  # ~5 min: migrations on a long-behind QA DB can take several minutes before Node listens.
  for attempt in $(seq 1 50); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "${name}" 2>/dev/null || echo missing)"
    if [ "${status}" = "healthy" ]; then
      return 0
    fi
    # Crash loop: surface quickly with exit code for caller to dump logs.
    local running
    running="$(docker inspect -f '{{.State.Running}}' "${name}" 2>/dev/null || echo false)"
    if [ "${running}" != "true" ] && [ "${attempt}" -ge 3 ]; then
      return 1
    fi
    if [ $((attempt % 5)) -eq 0 ]; then
      log "Waiting for ${name} health (attempt ${attempt}/50, status=${status})…"
    fi
    sleep 6
  done
  return 1
}

run_stack_deploy() {
  cd "${REPO_ROOT}"

  [ -n "${BACKEND_IMAGE:-}" ] || die "BACKEND_IMAGE is required (GHCR pull-only deploy — never build on host)"
  [ -n "${NGINX_IMAGE:-}" ] || die "NGINX_IMAGE is required (GHCR pull-only deploy — never build on host)"

  upsert_env_var BACKEND_IMAGE "${BACKEND_IMAGE}"
  upsert_env_var NGINX_IMAGE "${NGINX_IMAGE}"
  if [ -n "${GHCR_TOKEN:-}" ] && [ -n "${GHCR_USER:-}" ]; then
    echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
  fi

  # Self-hosted QA/Factory boxes accumulate old GHCR SHA tags until overlayfs fills up.
  prune_docker_disk_before_pull

  log "Pulling pre-built images (Build Once → Deploy Many)…"
  log "  backend: ${BACKEND_IMAGE}"
  log "  nginx:   ${NGINX_IMAGE}"
  compose pull backend nginx
  # Do NOT --force-recreate the whole stack: recreating db/redis/ST every deploy
  # races backend health (ST is only service_started) and flakes QA. Compose
  # recreates backend/nginx when BACKEND_IMAGE / NGINX_IMAGE change.
  compose up -d --remove-orphans --no-build db redis supertokens
  wait_for_container_healthy zedral-db || die "db did not become healthy before migrate"

  # Discrete migrate before backend boot (failed migrate ≠ health crash-loop).
  if [ "${SKIP_MIGRATE:-false}" = "true" ]; then
    log "SKIP_MIGRATE=true — migrations disabled for this deploy"
    export RUN_MIGRATIONS=false
  else
    log "Running database migrations as discrete pre-start step…"
    if ! RUN_MIGRATIONS=true compose run --rm --no-deps -e RUN_MIGRATIONS=true backend true; then
      compose logs --tail 200 || true
      die "Migration step failed — backend will not start (see logs above)"
    fi
    export RUN_MIGRATIONS=false
  fi

  compose up -d --no-build --no-deps backend
  if ! wait_for_container_healthy zedral-backend; then
    log "Backend failed health — last logs:"
    compose logs --tail 200 backend || true
    die "Backend did not become healthy after image switch"
  fi
  compose up -d --no-build --no-deps nginx
}

# Free unused Docker layers before pull. Keeps images still used by running containers.
prune_docker_disk_before_pull() {
  log "Docker disk before prune:"
  df -h / /var/lib/docker 2>/dev/null || df -h / || true
  docker system df 2>/dev/null || true
  docker container prune -f >/dev/null 2>&1 || true
  # -a removes unused images (not just dangling); running stack images stay referenced.
  docker image prune -af >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  log "Docker disk after prune:"
  df -h / /var/lib/docker 2>/dev/null || df -h / || true
  docker system df 2>/dev/null || true
}

verify_deployment_health() {
  local http_port="${HTTP_PORT:-80}"
  log "Container status:"
  compose ps || true
  docker ps --filter "name=zedral-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

  for c in zedral-db zedral-backend zedral-nginx; do
    wait_for_container_running "${c}"
  done

  wait_for_container_healthy zedral-db || die "db did not become healthy"
  if ! wait_for_container_healthy zedral-backend; then
    compose logs --tail 200 backend || true
    die "Container zedral-backend did not become healthy — see logs above"
  fi

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

  compose logs --tail 100 backend nginx || true
  die "Health check failed at http://127.0.0.1:${http_port}/health — inspect: compose logs backend nginx"
}

record_successful_deploy() {
  if [ -n "${BACKEND_IMAGE:-}" ] && [ -n "${NGINX_IMAGE:-}" ]; then
    save_image_checkpoint
  fi
  log "Recorded successful deploy"
}
