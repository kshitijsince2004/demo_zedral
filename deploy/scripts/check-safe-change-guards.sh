#!/usr/bin/env bash
# Guard rails (SAFE_CHANGE item 10): sourcemaps stay off; ES URL key stays documented for prod.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

VITE="${ROOT}/packages/client/vite.config.ts"
if grep -E "sourcemap\s*:\s*true" "${VITE}" >/dev/null 2>&1; then
  echo "::error::build.sourcemap must stay unset/false (found sourcemap: true in vite.config.ts)"
  exit 1
fi
echo "OK: vite sourcemap not enabled"

ENV_EX="${ROOT}/deploy/.env.production.example"
if ! grep -q '^ELASTICSEARCH_URL=' "${ENV_EX}"; then
  echo "::error::ELASTICSEARCH_URL must remain in deploy/.env.production.example for traceability ops"
  exit 1
fi
echo "OK: ELASTICSEARCH_URL present in production example env"
