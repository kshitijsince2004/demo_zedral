#!/usr/bin/env bash
# Generate JWT_SECRET, DB_PASSWORD (migrate), DB_APP_PASSWORD (runtime RLS) in deploy/.env.
set -euo pipefail

ENV_FILE="${1:-/opt/zedral/deploy/.env}"
[ -f "${ENV_FILE}" ] || { echo "Missing ${ENV_FILE}" >&2; exit 1; }

JWT="$(openssl rand -hex 32)"
DB="$(openssl rand -hex 16)"
APP_DB="$(openssl rand -hex 16)"

sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${JWT}/" "${ENV_FILE}"
sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=${DB}/" "${ENV_FILE}"
sed -i "s/^DB_APP_PASSWORD=.*/DB_APP_PASSWORD=${APP_DB}/" "${ENV_FILE}"
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://m1_app:${APP_DB}@db:5432/m1_db|" "${ENV_FILE}"
if grep -q '^MIGRATE_DATABASE_URL=' "${ENV_FILE}"; then
  sed -i "s|^MIGRATE_DATABASE_URL=.*|MIGRATE_DATABASE_URL=postgres://m1_user:${DB}@db:5432/m1_db|" "${ENV_FILE}"
fi

if grep -q 'CHANGE_ME' "${ENV_FILE}"; then
  echo "WARN: some CHANGE_ME placeholders remain in ${ENV_FILE}"
  exit 1
fi

echo "Production secrets written to ${ENV_FILE}"
