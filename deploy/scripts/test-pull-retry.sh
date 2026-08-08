#!/usr/bin/env bash
# Verifies pull_image_ref_with_retry recovers after transient pull failures,
# and upsert_env_var / assert helpers keep a single image source of truth.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
bash -n "${ROOT}/deploy/lib/common.sh"
echo SYNTAX_OK

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- pull retry ---
cat > "${TMP}/docker_mock.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# args: pull <ref>
REF="${2:?}"
SAFE="$(printf '%s' "${REF}" | tr '/:' '__')"
COUNT_FILE="${MOCK_DIR}/${SAFE}.count"
n="$(cat "${COUNT_FILE}" 2>/dev/null || echo 0)"
n=$((n + 1))
echo "${n}" > "${COUNT_FILE}"
echo "mock docker pull ${REF} attempt ${n}"
if [ "${n}" -lt 3 ]; then
  exit 1
fi
exit 0
EOF
chmod +x "${TMP}/docker_mock.sh"

# shellcheck source=../../deploy/lib/common.sh
source "${ROOT}/deploy/lib/common.sh"

docker() {
  if [ "${1:-}" = "pull" ]; then
    MOCK_DIR="${TMP}" "${TMP}/docker_mock.sh" "$@"
  else
    echo "unexpected docker $*" >&2
    exit 1
  fi
}
sleep() { :; }

PULL_MAX_ATTEMPTS=5
pull_image_ref_with_retry "ghcr.io/example/nginx:aaa" nginx
pull_image_ref_with_retry "ghcr.io/example/backend:bbb" backend
test "$(cat "${TMP}/ghcr.io_example_nginx_aaa.count")" = "3"
test "$(cat "${TMP}/ghcr.io_example_backend_bbb.count")" = "3"
echo PULL_RETRY_OK

# --- upsert dedupe ---
ENV_FILE="${TMP}/env"
printf 'BACKEND_IMAGE=old-a\nBACKEND_IMAGE=old-b\nNGINX_IMAGE=old-n\nOTHER=1\n' > "${ENV_FILE}"
upsert_env_var BACKEND_IMAGE "new-backend"
upsert_env_var NGINX_IMAGE "new-nginx"
test "$(grep -c '^BACKEND_IMAGE=' "${ENV_FILE}")" = "1"
test "$(grep -c '^NGINX_IMAGE=' "${ENV_FILE}")" = "1"
grep -qxF 'BACKEND_IMAGE=new-backend' "${ENV_FILE}"
grep -qxF 'NGINX_IMAGE=new-nginx' "${ENV_FILE}"
grep -qxF 'OTHER=1' "${ENV_FILE}"
echo UPSERT_OK

echo ALL_OK
