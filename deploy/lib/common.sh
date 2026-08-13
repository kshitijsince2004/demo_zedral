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

# Daemon must be reachable. `docker --version` is client-only and hides
# socket permission errors until a later pull wastes minutes retrying.
assert_docker_daemon() {
  docker info >/dev/null 2>&1 && return 0
  echo "user=$(id -un) uid=$(id -u) groups=$(id -Gn)" >&2
  ls -l /var/run/docker.sock >&2 || echo "no /var/run/docker.sock" >&2
  die "Cannot talk to Docker daemon as $(id -un). sudo usermod -aG docker $(id -un) then restart the runner (cd runner dir; sudo ./svc.sh stop && sudo ./svc.sh start)."
}

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
  assert_docker_daemon
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

  # CORS_ORIGIN empty/missing → copy WEBSITE_DOMAIN (browsers hit that host).
  # Avoids backend crash-loop / preflight die when domains were set but CORS was forgotten (QA #179).
  local website_domain cors_raw origin cors_found=0 tmp_cors
  website_domain="$(grep -E '^WEBSITE_DOMAIN=' "${ENV_FILE}" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
  website_domain="${website_domain#\"}"
  website_domain="${website_domain%\"}"
  website_domain="${website_domain#\'}"
  website_domain="${website_domain%\'}"
  website_domain="${website_domain#"${website_domain%%[![:space:]]*}"}"
  website_domain="${website_domain%"${website_domain##*[![:space:]]}"}"
  if [ -n "${website_domain}" ]; then
    cors_raw=""
    if grep -q '^CORS_ORIGIN=' "${ENV_FILE}"; then
      cors_raw="$(grep -E '^CORS_ORIGIN=' "${ENV_FILE}" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
      cors_raw="${cors_raw#\"}"
      cors_raw="${cors_raw%\"}"
      cors_raw="${cors_raw#\'}"
      cors_raw="${cors_raw%\'}"
      cors_raw="${cors_raw#"${cors_raw%%[![:space:]]*}"}"
      cors_raw="${cors_raw%"${cors_raw##*[![:space:]]}"}"
      if [ -n "${cors_raw}" ]; then
        while IFS= read -r origin; do
          origin="${origin#"${origin%%[![:space:]]*}"}"
          origin="${origin%"${origin##*[![:space:]]}"}"
          [ -n "${origin}" ] && cors_found=1 && break
        done < <(printf '%s\n' "${cors_raw}" | tr ',' '\n')
      fi
    fi
    if [ "${cors_found}" -eq 0 ]; then
      tmp_cors="$(mktemp)"
      grep -v '^CORS_ORIGIN=' "${ENV_FILE}" > "${tmp_cors}" || true
      printf 'CORS_ORIGIN=%s\n' "${website_domain}" >> "${tmp_cors}"
      mv "${tmp_cors}" "${ENV_FILE}"
      log "Auto-filled CORS_ORIGIN=${website_domain} from WEBSITE_DOMAIN"
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

  # Match packages/server getConfiguredCorsOrigins(): comma-separated, ≥1 non-empty after trim.
  local cors_raw origin cors_found=0
  cors_raw="${CORS_ORIGIN:-}"
  cors_raw="${cors_raw#"${cors_raw%%[![:space:]]*}"}"
  cors_raw="${cors_raw%"${cors_raw##*[![:space:]]}"}"
  if [ -z "${cors_raw}" ]; then
    die "deploy/.env is missing CORS_ORIGIN — set at least one browser origin, e.g. CORS_ORIGIN=https://qa.zedral.com"
  fi
  while IFS= read -r origin; do
    origin="${origin#"${origin%%[![:space:]]*}"}"
    origin="${origin%"${origin##*[![:space:]]}"}"
    [ -z "${origin}" ] && continue
    cors_found=1
    case "${origin}" in
      http://*|https://*) ;;
      *)
        log "WARNING: CORS_ORIGIN entry '${origin}' does not start with http:// or https:// — likely misconfigured"
        ;;
    esac
  done < <(printf '%s\n' "${cors_raw}" | tr ',' '\n')
  if [ "${cors_found}" -eq 0 ]; then
    die "deploy/.env is missing CORS_ORIGIN — set at least one browser origin, e.g. CORS_ORIGIN=https://qa.zedral.com"
  fi

  log "Environment validation passed (bootstrap DB_USER=${DB_USER})."
}

# Resolve deploy checkout root (ops APP_BASE preferred). Sets REPO_ROOT / COMPOSE_FILE / ENV_FILE.
# Mirrors deploy/scripts/remote-ghcr-deploy.sh candidate selection.
resolve_repo_root() {
  local caller_dir candidate=""
  if [ -n "${APP_BASE:-}" ] && [ -f "${APP_BASE}/deploy/lib/common.sh" ]; then
    candidate="${APP_BASE}"
  else
    if [ "${#BASH_SOURCE[@]}" -ge 2 ]; then
      caller_dir="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)" || return 1
      candidate="$(cd "${caller_dir}/../.." && pwd)" || return 1
    elif [ -n "${REPO_ROOT:-}" ]; then
      candidate="${REPO_ROOT}"
    else
      return 1
    fi
    if [ -n "${APP_BASE:-}" ] && [ -f "${APP_BASE}/$(basename "${candidate}")/deploy/lib/common.sh" ]; then
      candidate="${APP_BASE}/$(basename "${candidate}")"
    fi
  fi
  [ -n "${candidate}" ] || return 1
  [ -f "${candidate}/deploy/lib/common.sh" ] || return 1
  [ -f "${candidate}/deploy/docker-compose.prod.yml" ] || return 1
  REPO_ROOT="${candidate}"
  COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.prod.yml"
  ENV_FILE="${REPO_ROOT}/deploy/.env"
  export REPO_ROOT COMPOSE_FILE ENV_FILE
  return 0
}

# Sync SuperTokens / CORS hosts from the public browser origin (e.g. https://qa.zedral.com).
# Fixes smoke login when .env still has EIP or example.com while Cloudflare serves the real host.
sync_public_origin() {
  local origin="${PUBLIC_BASE_URL:-${AWS_PUBLIC_URL:-}}"
  origin="${origin%"${origin##*[![:space:]]}"}"
  origin="${origin#"${origin%%[![:space:]]*}"}"
  origin="${origin%/}"
  [ -n "${origin}" ] || return 0
  case "${origin}" in
    http://*|https://*) ;;
    *)
      log "WARNING: PUBLIC_BASE_URL='${origin}' is not http(s) — skipping domain sync"
      return 0
      ;;
  esac
  upsert_env_var API_DOMAIN "${origin}"
  upsert_env_var WEBSITE_DOMAIN "${origin}"
  upsert_env_var CORS_ORIGIN "${origin}"
  export API_DOMAIN="${origin}" WEBSITE_DOMAIN="${origin}" CORS_ORIGIN="${origin}"
  log "Synced API_DOMAIN/WEBSITE_DOMAIN/CORS_ORIGIN → ${origin}"
}

# Ensure seeded pilot login profiles exist (badge 3000 etc.). Gated — QA only.
# Prod image has no npm — call node scripts directly (WORKDIR /app/packages/server).
# When ENSURE_SMOKE_USERS=true, seed failure is fatal (smoke cannot pass without badge 3000).
ensure_login_profiles() {
  if [ "${ENSURE_SMOKE_USERS:-false}" != "true" ]; then
    return 0
  fi
  # Trim CR/LF/spaces — GitHub secrets often include a trailing newline.
  local pin
  pin="$(printf '%s' "${SEED_PIN:-${SMOKE_PIN:-5678}}" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if ! printf '%s' "${pin}" | grep -Eq '^[0-9]{4}$'; then
    echo "::error::SMOKE_PIN/SEED_PIN must be exactly 4 digits after trim (got length=${#pin})"
    return 1
  fi
  log "Ensuring pilot login profiles (SEED_PIN set, node scripts/seed-login-profiles.mjs)…"
  if compose exec -T -e SEED_PIN="${pin}" backend node scripts/seed-login-profiles.mjs; then
    log "Pilot login profiles ready (operator badge 3000 / PIN from SEED_PIN)"
    return 0
  fi
  # Fresh containers may not accept exec yet — fall back to one-shot run (needs db).
  if compose run --rm -e SEED_PIN="${pin}" backend node scripts/seed-login-profiles.mjs; then
    log "Pilot login profiles ready (operator badge 3000 / PIN from SEED_PIN)"
    return 0
  fi
  echo "::error::seed:profiles failed — cannot run smoke without badge 3000"
  log "ERROR: seed:profiles failed"
  return 1
}

# After seed: prove badge+PIN works through nginx (catches PIN/secret drift before Playwright).
assert_smoke_badge_login() {
  if [ "${ENSURE_SMOKE_USERS:-false}" != "true" ]; then
    return 0
  fi
  local badge pin http_port base code body
  badge="$(printf '%s' "${SMOKE_BADGE_ID:-3000}" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  pin="$(printf '%s' "${SEED_PIN:-${SMOKE_PIN:-5678}}" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  http_port="${HTTP_PORT:-80}"
  base="http://127.0.0.1:${http_port}"
  body="$(mktemp)"
  code="$(curl -sS -o "${body}" -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    -H 'st-auth-mode: header' \
    --data "{\"badgeId\":\"${badge}\",\"pin\":\"${pin}\"}" \
    --max-time 20 \
    "${base}/auth/badge-pin" 2>/dev/null || echo "000")"
  if [ "${code}" != "200" ]; then
    echo "::error::Smoke badge-pin login failed (HTTP ${code}) for badge=${badge}. Body: $(head -c 200 "${body}" 2>/dev/null || true)"
    echo "::error::Re-check staging secrets SMOKE_BADGE_ID/SMOKE_PIN (4-digit PIN, no newline) and seed logs."
    rm -f "${body}"
    return 1
  fi
  rm -f "${body}"
  log "Smoke badge-pin OK: badge=${badge} → HTTP 200"
  return 0
}

# Fail if nginx /auth or /api proxy is broken (variable URI rewrite → Express 404 / Cannot GET /).
# 401/400/403/422 are fine without a session; 404 is a routing regression.
assert_http_not_404() {
  local method="$1"
  local url="$2"
  local label="${3:-${method} ${url}}"
  local code
  if [ "${method}" = "GET" ] || [ "${method}" = "HEAD" ]; then
    code="$(curl -sS -o /dev/null -w '%{http_code}' -X "${method}" \
      --max-time 15 \
      "${url}" 2>/dev/null || echo "000")"
  else
    code="$(curl -sS -o /dev/null -w '%{http_code}' -X "${method}" \
      -H 'Content-Type: application/json' \
      --data '{}' \
      --max-time 15 \
      "${url}" 2>/dev/null || echo "000")"
  fi
  if [ "${code}" = "404" ]; then
    die "${label} → 404 (nginx proxy routing regression; see deploy/nginx.prod.conf)"
  fi
  if [ "${code}" = "000" ]; then
    die "${label} failed (no HTTP response)"
  fi
  log "Route OK: ${label} → HTTP ${code} (404 would be a proxy bug)"
}

assert_local_auth_routes() {
  local http_port="${HTTP_PORT:-80}"
  local base="http://127.0.0.1:${http_port}"
  assert_http_not_404 POST "${base}/auth/session/refresh"
  assert_http_not_404 POST "${base}/auth/badge-pin"
  assert_http_not_404 GET "${base}/api/shifts/current"
  assert_http_not_404 GET "${base}/api/6hi/queue"
  assert_http_not_404 GET "${base}/api/tenant-flags"
}

# Public URL check (Cloudflare → origin nginx). Fatal on 404 when URL is set.
assert_public_auth_routes() {
  local base="${AWS_PUBLIC_URL:-${PUBLIC_BASE_URL:-}}"
  base="${base%"${base##*[![:space:]]}"}"
  base="${base#"${base%%[![:space:]]*}"}"
  base="${base%/}"
  [ -n "${base}" ] || return 0
  assert_http_not_404 POST "${base}/auth/session/refresh"
  assert_http_not_404 POST "${base}/auth/badge-pin"
  assert_http_not_404 GET "${base}/api/shifts/current"
  assert_http_not_404 GET "${base}/api/6hi/queue"
  assert_http_not_404 GET "${base}/api/tenant-flags"
}

# Rewrite KEY=… so deploy/.env never accumulates duplicate keys (Compose
# interpolation is ambiguous when the same key appears twice).
upsert_env_var() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  if [ -f "${ENV_FILE}" ]; then
    grep -v "^${key}=" "${ENV_FILE}" > "${tmp}" || true
  else
    : > "${tmp}"
  fi
  printf '%s=%s\n' "${key}" "${value}" >> "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

# Fail fast if Compose would deploy a different image than the shell/CI intended.
# Root cause of QA #177: logs showed SHA A while containers ran SHA B from stale .env.
assert_compose_images() {
  local images
  export BACKEND_IMAGE NGINX_IMAGE
  images="$(compose config --images)" || die "compose config --images failed — cannot verify image tags"
  printf '%s\n' "${images}" | grep -qxF "${BACKEND_IMAGE}" \
    || die "Compose config missing intended backend image: ${BACKEND_IMAGE} (config --images: ${images})"
  printf '%s\n' "${images}" | grep -qxF "${NGINX_IMAGE}" \
    || die "Compose config missing intended nginx image: ${NGINX_IMAGE} (config --images: ${images})"
  grep -qxF "BACKEND_IMAGE=${BACKEND_IMAGE}" "${ENV_FILE}" \
    || die "deploy/.env missing exact BACKEND_IMAGE=${BACKEND_IMAGE}"
  grep -qxF "NGINX_IMAGE=${NGINX_IMAGE}" "${ENV_FILE}" \
    || die "deploy/.env missing exact NGINX_IMAGE=${NGINX_IMAGE}"
  # Duplicate keys are the classic split-brain source — refuse to continue.
  if [ "$(grep -c "^BACKEND_IMAGE=" "${ENV_FILE}" || true)" -ne 1 ]; then
    die "deploy/.env has duplicate BACKEND_IMAGE= lines"
  fi
  if [ "$(grep -c "^NGINX_IMAGE=" "${ENV_FILE}" || true)" -ne 1 ]; then
    die "deploy/.env has duplicate NGINX_IMAGE= lines"
  fi
  log "Compose image assert OK (backend + nginx match intended tags)"
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

# Pull an exact image ref with retry/backoff (not `compose pull <service>` —
# that interpolates via env-file and can also pull sibling deps under a stale tag).
pull_image_ref_with_retry() {
  local ref="$1"
  local label="${2:-image}"
  local max_attempts="${PULL_MAX_ATTEMPTS:-5}"
  local attempt=1
  local delay start end
  # Long GHCR transfers stall under the default ~60s client timeout.
  export COMPOSE_HTTP_TIMEOUT="${COMPOSE_HTTP_TIMEOUT:-300}"

  while [ "${attempt}" -le "${max_attempts}" ]; do
    start="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)"
    log "Pull ${label} attempt ${attempt}/${max_attempts} start=${start} ref=${ref}"
    if docker pull "${ref}"; then
      end="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)"
      log "Pull ${label} OK end=${end}"
      return 0
    fi
    end="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)"
    log "Pull ${label} failed attempt ${attempt}/${max_attempts} end=${end}"
    # Socket / group errors are not transient — do not backoff.
    assert_docker_daemon
    if [ "${attempt}" -ge "${max_attempts}" ]; then
      break
    fi
    case "${attempt}" in
      1) delay=10 ;;
      2) delay=30 ;;
      *) delay=60 ;;
    esac
    log "Retrying ${label} pull in ${delay}s…"
    sleep "${delay}"
    attempt=$((attempt + 1))
  done
  return 1
}

probe_ghcr_connectivity() {
  log "Pre-deploy GHCR reachability probe…"
  if curl -fsS --max-time 15 -o /dev/null "https://ghcr.io/v2/"; then
    log "GHCR reachable (HTTP OK)"
    return 0
  fi
  # Registry often returns 401 without auth — still proves TCP/TLS path works.
  local code
  code="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "https://ghcr.io/v2/" || true)"
  if [ "${code}" = "401" ] || [ "${code}" = "403" ]; then
    log "GHCR reachable (HTTP ${code})"
    return 0
  fi
  log "WARNING: GHCR probe unexpected (HTTP ${code:-none}) — pull may still succeed after login"
  return 0
}

run_stack_deploy() {
  cd "${REPO_ROOT}"

  [ -n "${BACKEND_IMAGE:-}" ] || die "BACKEND_IMAGE is required (GHCR pull-only deploy — never build on host)"
  [ -n "${NGINX_IMAGE:-}" ] || die "NGINX_IMAGE is required (GHCR pull-only deploy — never build on host)"

  # Shell + .env must agree before Compose interpolates anything.
  export BACKEND_IMAGE NGINX_IMAGE
  upsert_env_var BACKEND_IMAGE "${BACKEND_IMAGE}"
  upsert_env_var NGINX_IMAGE "${NGINX_IMAGE}"
  assert_compose_images

  if [ -n "${GHCR_TOKEN:-}" ] && [ -n "${GHCR_USER:-}" ]; then
    echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
  fi

  # Self-hosted QA/Factory boxes accumulate old GHCR SHA tags until overlayfs fills up.
  prune_docker_disk_before_pull

  probe_ghcr_connectivity

  log "Pulling pre-built images (Build Once → Deploy Many)…"
  log "  backend: ${BACKEND_IMAGE}"
  log "  nginx:   ${NGINX_IMAGE}"
  pull_image_ref_with_retry "${NGINX_IMAGE}" nginx \
    || die "Failed to pull nginx image after retries: ${NGINX_IMAGE}"
  pull_image_ref_with_retry "${BACKEND_IMAGE}" backend \
    || die "Failed to pull backend image after retries: ${BACKEND_IMAGE}"

  # Do NOT --force-recreate db/redis/ST — races backend health and flakes QA.
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

  # Always recreate app pair together. Soft recreate left nginx on a stale
  # container (QA #177: nginx Up 21h) while backend moved — sticky upstream IP.
  log "Recreating backend + nginx on intended tags…"
  compose up -d --no-build --no-deps --force-recreate backend
  if ! wait_for_container_healthy zedral-backend; then
    log "Backend failed health — last logs:"
    compose logs --tail 200 backend || true
    die "Backend did not become healthy after image switch"
  fi
  compose up -d --no-build --no-deps --force-recreate nginx
  if ! wait_for_container_healthy zedral-nginx; then
    log "Nginx failed health — last logs:"
    compose logs --tail 200 nginx || true
    die "Nginx did not become healthy after image switch"
  fi

  # Prove running containers match intended tags (not just compose config).
  local running_backend running_nginx
  running_backend="$(docker inspect -f '{{.Config.Image}}' zedral-backend)"
  running_nginx="$(docker inspect -f '{{.Config.Image}}' zedral-nginx)"
  [ "${running_backend}" = "${BACKEND_IMAGE}" ] \
    || die "Running backend image mismatch: intended=${BACKEND_IMAGE} running=${running_backend}"
  [ "${running_nginx}" = "${NGINX_IMAGE}" ] \
    || die "Running nginx image mismatch: intended=${NGINX_IMAGE} running=${running_nginx}"
  log "Running containers match intended tags"
}

# Free unused Docker layers before pull. Keeps images still used by running containers.
prune_docker_disk_before_pull() {
  log "Docker disk before prune:"
  df -h / /var/lib/docker 2>/dev/null || df -h / || true
  docker system df || log "WARNING: docker system df failed"
  docker container prune -f >/dev/null || log "WARNING: docker container prune failed"
  # -a removes unused images (not just dangling); running stack images stay referenced.
  docker image prune -af >/dev/null || log "WARNING: docker image prune failed"
  docker builder prune -af >/dev/null || log "WARNING: docker builder prune failed"
  log "Docker disk after prune:"
  df -h / /var/lib/docker 2>/dev/null || df -h / || true
  docker system df || log "WARNING: docker system df failed"
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
  if ! wait_for_container_healthy zedral-nginx; then
    compose logs --tail 200 nginx || true
    die "Container zedral-nginx did not become healthy — see logs above"
  fi

  log "HTTP health check via nginx (port ${http_port})…"
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if curl -fsS "http://127.0.0.1:${http_port}/health" | head -c 200; then
      echo ""
      log "Health check passed"
      assert_local_auth_routes
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
