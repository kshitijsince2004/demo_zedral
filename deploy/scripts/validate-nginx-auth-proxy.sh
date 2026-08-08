#!/usr/bin/env bash
# Validate deploy/nginx.prod.conf proxy contracts:
#   /auth/  — preserve full URI (no …/auth/ rewrite)
#   /api/   — strip /api via rewrite + variable proxy_pass (never …/; alone)
# Usage:
#   bash deploy/scripts/validate-nginx-auth-proxy.sh
#   bash deploy/scripts/validate-nginx-auth-proxy.sh zedral-nginx:ci
# shellcheck disable=SC2016  # greps match literal $backend_upstream in nginx conf
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONF="${REPO_ROOT}/deploy/nginx.prod.conf"
IMAGE="${1:-}"

die() { echo "ERROR: $*" >&2; exit 1; }

extract_location() {
  local path="$1"
  local file="$2"
  awk -v loc="location ${path}" '
    index($0, loc) { grab=1 }
    grab { print }
    grab && /^[[:space:]]*}[[:space:]]*$/ { exit }
  ' "${file}"
}

[ -f "${CONF}" ] || die "missing ${CONF}"

auth_block="$(extract_location '/auth/' "${CONF}")"
[ -n "${auth_block}" ] || die "could not find location /auth/ in ${CONF}"

echo "${auth_block}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream[[:space:]]*;' \
  || die "/auth/ must use: proxy_pass http://\$backend_upstream; (preserve URI)"

if echo "${auth_block}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream/auth/'; then
  die "/auth/ must NOT use proxy_pass …/auth/ (variable proxy_pass replaces entire URI → Express 404)"
fi

echo "OK: source ${CONF} preserves /auth URI"

api_block="$(extract_location '/api/' "${CONF}")"
[ -n "${api_block}" ] || die "could not find location /api/ in ${CONF}"

echo "${api_block}" | grep -qE 'rewrite[[:space:]]+\^/api/' \
  || die "/api/ must rewrite ^/api/(.*)$ before proxy_pass (strip prefix for Express)"

echo "${api_block}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream[[:space:]]*;' \
  || die "/api/ must use: proxy_pass http://\$backend_upstream; after rewrite"

if echo "${api_block}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream/'; then
  die "/api/ must NOT use proxy_pass …/; (variable proxy_pass replaces entire URI with / → Cannot GET /)"
fi

echo "OK: source ${CONF} strips /api via rewrite (no variable …/; rewrite)"

if [ -n "${IMAGE}" ]; then
  echo "Running nginx -t in image ${IMAGE}…"
  docker run --rm --entrypoint nginx "${IMAGE}" -t \
    || die "nginx -t failed in ${IMAGE}"

  img_conf="$(docker run --rm --entrypoint cat "${IMAGE}" /etc/nginx/nginx.conf)"
  tmp_img="$(mktemp)"
  printf '%s\n' "${img_conf}" > "${tmp_img}"

  img_auth="$(extract_location '/auth/' "${tmp_img}")"
  echo "${img_auth}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream[[:space:]]*;' \
    || die "image ${IMAGE} /auth/ missing proxy_pass http://\$backend_upstream;"
  if echo "${img_auth}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream/auth/'; then
    die "image ${IMAGE} still has proxy_pass …/auth/ rewrite"
  fi

  img_api="$(extract_location '/api/' "${tmp_img}")"
  echo "${img_api}" | grep -qE 'rewrite[[:space:]]+\^/api/' \
    || die "image ${IMAGE} /api/ missing rewrite ^/api/"
  if echo "${img_api}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream/'; then
    die "image ${IMAGE} still has proxy_pass …/; for /api/"
  fi
  rm -f "${tmp_img}"
  echo "OK: image ${IMAGE} nginx -t + /auth + /api proxy"
fi
