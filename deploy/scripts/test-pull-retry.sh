#!/usr/bin/env bash
# Verifies pull_compose_service_with_retry recovers after transient pull failures.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
bash -n "${ROOT}/deploy/lib/common.sh"
echo SYNTAX_OK

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "${TMP}/compose_mock.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SVC="${2:?}"
COUNT_FILE="${MOCK_DIR}/${SVC}.count"
n="$(cat "${COUNT_FILE}" 2>/dev/null || echo 0)"
n=$((n + 1))
echo "${n}" > "${COUNT_FILE}"
echo "mock compose pull ${SVC} attempt ${n}"
if [ "${n}" -lt 3 ]; then
  exit 1
fi
exit 0
EOF
chmod +x "${TMP}/compose_mock.sh"

# shellcheck source=../../deploy/lib/common.sh
source "${ROOT}/deploy/lib/common.sh"

compose() {
  if [ "${1:-}" = "pull" ]; then
    MOCK_DIR="${TMP}" "${TMP}/compose_mock.sh" "$@"
  else
    echo "unexpected compose $*" >&2
    exit 1
  fi
}

# Real function uses sleep for backoff — no-op in unit test.
sleep() { :; }

PULL_MAX_ATTEMPTS=5
pull_compose_service_with_retry nginx
pull_compose_service_with_retry backend
echo "nginx attempts=$(cat "${TMP}/nginx.count")"
echo "backend attempts=$(cat "${TMP}/backend.count")"
test "$(cat "${TMP}/nginx.count")" = "3"
test "$(cat "${TMP}/backend.count")" = "3"
echo RETRY_OK
