#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  MIGRATE_USER="${DB_MIGRATE_USER:-${DB_USER:-}}"
  MIGRATE_PASSWORD="${DB_MIGRATE_PASSWORD:-${DB_PASSWORD:-}}"

  if [ -n "${DB_HOST:-}" ] && [ -n "${MIGRATE_USER}" ] && [ -n "${MIGRATE_PASSWORD}" ] && [ -n "${DB_NAME:-}" ]; then
    export DATABASE_URL="postgres://${MIGRATE_USER}:${MIGRATE_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}"
  elif [ -n "${DATABASE_URL:-}" ]; then
    export DATABASE_URL
  fi

  if [ -n "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] Running database migrations as ${MIGRATE_USER:-runtime user}…"
    MIGRATE_BIN="/app/node_modules/node-pg-migrate/bin/node-pg-migrate.js"
    node "${MIGRATE_BIN}" --migrations-dir migrations up
    node "${MIGRATE_BIN}" --migrations-dir migrations/modules/m1 --migrations-table pgmigrations_m1 up
    echo "[entrypoint] Migrations complete."
  else
    echo "[entrypoint] WARN: DATABASE_URL / DB_* not set — skipping migrations."
  fi
fi

exec "$@"
