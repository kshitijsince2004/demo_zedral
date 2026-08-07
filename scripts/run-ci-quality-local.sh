#!/usr/bin/env bash
# Mirror GitHub Actions CI "quality" job (lint/build/unit/integration/arch) + backend image build.
# Usage (from repo root, Docker Desktop required):
#   bash scripts/run-ci-quality-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Docker Desktop bind-mount: prefer a Windows path from Git Bash.
if command -v cygpath >/dev/null 2>&1; then
  MOUNT_ROOT="$(cygpath -w "$ROOT")"
else
  MOUNT_ROOT="$ROOT"
fi
IMAGE_NODE="node:20-bookworm"

# Load DB URL from host .env if present; default to local docker-compose creds.
if [[ -f "${ROOT}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  # Only export DB-related keys (avoid sourcing secrets into unrelated tools).
  while IFS= read -r line; do
    case "$line" in
      DB_*|DATABASE_URL=*|MIGRATE_DATABASE_URL=*|TEST_DATABASE_URL=*|JWT_SECRET=*|AUTH_STRICT=*|TENANT_ID=*)
        export "$line"
        ;;
    esac
  done < <(grep -E '^(DB_|DATABASE_URL=|MIGRATE_DATABASE_URL=|TEST_DATABASE_URL=|JWT_SECRET=|AUTH_STRICT=|TENANT_ID=)' "${ROOT}/.env" || true)
  set +a
fi

# Prefer compose service hostname when the local stack network exists (reliable on Docker Desktop).
COMPOSE_NET="hsl_zedral_m1_network"
DOCKER_NET_ARGS=(--add-host=host.docker.internal:host-gateway)
DB_HOST_IN_CONTAINER="host.docker.internal"
if docker network inspect "${COMPOSE_NET}" >/dev/null 2>&1; then
  DOCKER_NET_ARGS=(--network "${COMPOSE_NET}")
  DB_HOST_IN_CONTAINER="db-primary"
fi

DB_URL="${TEST_DATABASE_URL:-${MIGRATE_DATABASE_URL:-${DATABASE_URL:-postgres://m1_user:m1_password@${DB_HOST_IN_CONTAINER}:5432/m1_db}}}"
# Inside the container, localhost is the container — rewrite common local hosts.
DB_URL="${DB_URL//localhost/${DB_HOST_IN_CONTAINER}}"
DB_URL="${DB_URL//@127.0.0.1/@${DB_HOST_IN_CONTAINER}}"
DB_URL="${DB_URL//@db:/@${DB_HOST_IN_CONTAINER}:}"
DB_URL="${DB_URL//@host.docker.internal/@${DB_HOST_IN_CONTAINER}}"
DB_URL="${DB_URL//@db-primary/@${DB_HOST_IN_CONTAINER}}"

echo "==> CI quality mirror (node 20 container)"
echo "==> DATABASE_URL host rewritten for Docker: ${DB_URL%%@*}@*** (via ${DB_HOST_IN_CONTAINER})"

docker run --rm \
  "${DOCKER_NET_ARGS[@]}" \
  -v "${MOUNT_ROOT}:/src:ro" \
  -e NODE_ENV=test \
  -e DB_HOST="${DB_HOST_IN_CONTAINER}" \
  -e DB_PORT="${DB_PORT:-5432}" \
  -e DB_USER="${DB_USER:-m1_user}" \
  -e DB_PASSWORD="${DB_PASSWORD:-m1_password}" \
  -e DB_NAME="${DB_NAME:-m1_db}" \
  -e DB_APP_USER="${DB_APP_USER:-m1_app}" \
  -e DB_APP_PASSWORD="${DB_APP_PASSWORD:-m1_app_password}" \
  -e DATABASE_URL="${DB_URL}" \
  -e MIGRATE_DATABASE_URL="${DB_URL}" \
  -e TEST_DATABASE_URL="${DB_URL}" \
  -e JWT_SECRET="${JWT_SECRET:-ci-test-secret-at-least-16-chars-long}" \
  -e AUTH_STRICT="${AUTH_STRICT:-true}" \
  -e VITEST_DB_AVAILABLE=1 \
  "${IMAGE_NODE}" \
  bash -lc '
set -euo pipefail
apt-get update -qq
apt-get install -y -qq rsync >/dev/null
mkdir -p /app
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude dist-operator \
  --exclude "packages/*/dist" --exclude "packages/modules/*/dist" \
  --exclude "*.tsbuildinfo" --exclude "**/*.tsbuildinfo" \
  /src/ /app/
cd /app
npm install -g npm@11.4.2 >/dev/null
npm ci
node scripts/ensure-native-bindings.mjs
echo "==> Migration filename order"
node packages/server/scripts/check-migration-order.mjs
echo "==> ESLint"
npm run lint
echo "==> Build"
npm run build
echo "==> Client unit tests"
npm run test -w @m1/client
echo "==> Operator APK bundle check"
npm run check:operator-bundle -w @m1/client
echo "==> Migrate (strict order)"
MIGRATE_STRICT_ORDER=1 npm run migrate -w @m1/server
echo "==> Migrations up → down-all → up"
MIGRATE_STRICT_ORDER=1 npm run migrate:down:all -w @m1/server
MIGRATE_STRICT_ORDER=1 npm run migrate -w @m1/server
echo "==> db-types drift"
npm run db:codegen:check -w @m1/server
echo "==> Server unit tests"
npm run test:unit -w @m1/server
echo "==> Server integration tests"
npm run test:integration -w @m1/server
echo "==> Architecture check"
npm run arch:check
echo "==> CI quality mirror PASSED"
'

echo "==> Docker backend image build (CI docker-build-push target)"
docker build --target backend -t zedral-backend:ci-local "${MOUNT_ROOT}"

echo "==> QA public smoke"
curl -fsS https://qa.zedral.com/health | head -c 200; echo
curl -fsS -o /dev/null -w "login %{http_code}\n" https://qa.zedral.com/login
curl -fsS https://qa.zedral.com/api/health | head -c 200; echo

echo "==> ALL LOCAL CI/QA CHECKS COMPLETE"
