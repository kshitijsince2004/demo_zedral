#!/usr/bin/env bash
# One-shot: clean rsync + build shared packages then @m1/server (CI-like).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  MOUNT_ROOT="$(cygpath -w "$ROOT")"
else
  MOUNT_ROOT="$ROOT"
fi

docker run --rm \
  -v "${MOUNT_ROOT}:/src:ro" \
  node:20-bookworm \
  bash -lc '
set -euo pipefail
apt-get update -qq
apt-get install -y -qq rsync >/dev/null
mkdir -p /app
rsync -a --exclude node_modules --exclude .git --exclude dist \
  --exclude "*.tsbuildinfo" --exclude "**/*.tsbuildinfo" \
  --exclude "packages/*/dist" --exclude "packages/modules/*/dist" \
  /src/ /app/
cd /app
npm install -g npm@11.4.2 >/dev/null
npm ci
node scripts/ensure-native-bindings.mjs
npm run build -w @m1/shared-validation
echo "--- shared-validation dist ---"
ls -la packages/shared-validation/dist | head -20
test -f packages/shared-validation/dist/index.d.ts
npm run build -w @zedral/platform
npm run build -w @zedral/connectors
npm run build -w @zedral/m1-collection
echo "--- m1-collection dist ---"
ls packages/modules/m1-collection/dist | head -10
test -f packages/modules/m1-collection/dist/index.d.ts
npm run build -w @m1/server
echo SERVER_BUILD_OK
'
