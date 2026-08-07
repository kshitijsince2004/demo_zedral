#!/bin/sh
set -eu

# Preserve runtime app URL (m1_app / RLS). Migrations must not leave the process on the bootstrap role.
APP_DATABASE_URL="${DATABASE_URL:-}"

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  MIGRATE_USER="${DB_MIGRATE_USER:-}"
  MIGRATE_PASSWORD="${DB_MIGRATE_PASSWORD:-}"

  if [ -n "${DB_HOST:-}" ] && [ -n "${MIGRATE_USER}" ] && [ -n "${MIGRATE_PASSWORD}" ] && [ -n "${DB_NAME:-}" ]; then
    export DATABASE_URL="postgres://${MIGRATE_USER}:${MIGRATE_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}"
  elif [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
    export DATABASE_URL="${MIGRATE_DATABASE_URL}"
  fi

  if [ -n "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] Running database migrations as ${MIGRATE_USER:-migrate URL user}…"
    MIGRATE_BIN="/app/node_modules/node-pg-migrate/bin/node-pg-migrate.js"
    node "${MIGRATE_BIN}" --migrations-dir migrations up
    node "${MIGRATE_BIN}" --migrations-dir migrations/modules/m1 --migrations-table pgmigrations_m1 up
    echo "[entrypoint] Migrations complete."

    if [ -n "${DB_APP_USER:-}" ] && [ -n "${DB_APP_PASSWORD:-}" ]; then
      node /app/packages/server/scripts/sync-app-role-password.mjs
    fi
  else
    echo "[entrypoint] WARN: migrate credentials not set — skipping migrations."
  fi
fi

# Restore RLS app connection for the Node process (never stay on bootstrap/superuser).
if [ -n "${APP_DATABASE_URL}" ]; then
  export DATABASE_URL="${APP_DATABASE_URL}"
elif [ -n "${DB_HOST:-}" ] && [ -n "${DB_APP_USER:-}" ] && [ -n "${DB_APP_PASSWORD:-}" ] && [ -n "${DB_NAME:-}" ]; then
  export DATABASE_URL="postgres://${DB_APP_USER}:${DB_APP_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}"
fi

exec "$@"
