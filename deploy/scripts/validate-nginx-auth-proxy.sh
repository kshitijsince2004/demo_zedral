#!/usr/bin/env bash
# Validate deploy/nginx.prod.conf /auth/ proxy preserves the request URI.
# Usage:
#   bash deploy/scripts/validate-nginx-auth-proxy.sh
#   bash deploy/scripts/validate-nginx-auth-proxy.sh zedral-nginx:ci   # also nginx -t in image
# shellcheck disable=SC2016  # greps match literal $backend_upstream in nginx conf
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONF="${REPO_ROOT}/deploy/nginx.prod.conf"
IMAGE="${1:-}"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -f "${CONF}" ] || die "missing ${CONF}"

# Extract location /auth/ { ... } (first closing brace at same indent as "location")
auth_block="$(awk '
  /location \/auth\// { grab=1 }
  grab { print }
  grab && /^[[:space:]]*}[[:space:]]*$/ { exit }
' "${CONF}")"

[ -n "${auth_block}" ] || die "could not find location /auth/ in ${CONF}"

echo "${auth_block}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream[[:space:]]*;' \
  || die "/auth/ must use: proxy_pass http://\$backend_upstream; (preserve URI)"

if echo "${auth_block}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream/auth/'; then
  die "/auth/ must NOT use proxy_pass …/auth/ (variable proxy_pass replaces entire URI → Express 404)"
fi

echo "OK: source ${CONF} preserves /auth URI (no …/auth/ rewrite)"

if [ -n "${IMAGE}" ]; then
  echo "Running nginx -t in image ${IMAGE}…"
  docker run --rm --entrypoint nginx "${IMAGE}" -t \
    || die "nginx -t failed in ${IMAGE}"

  img_conf="$(docker run --rm --entrypoint cat "${IMAGE}" /etc/nginx/nginx.conf)"
  img_auth="$(printf '%s\n' "${img_conf}" | awk '
    /location \/auth\// { grab=1 }
    grab { print }
    grab && /^[[:space:]]*}[[:space:]]*$/ { exit }
  ')"
  echo "${img_auth}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream[[:space:]]*;' \
    || die "image ${IMAGE} /auth/ missing proxy_pass http://\$backend_upstream;"
  if echo "${img_auth}" | grep -qE 'proxy_pass[[:space:]]+http://\$backend_upstream/auth/'; then
    die "image ${IMAGE} still has proxy_pass …/auth/ rewrite"
  fi
  echo "OK: image ${IMAGE} nginx -t + /auth/ proxy"
fi
