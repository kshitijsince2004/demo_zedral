#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  if [ -n "${DATABASE_URL:-}" ]; then
    export DATABASE_URL
  elif [ -n "${DB_HOST:-}" ] && [ -n "${DB_USER:-}" ] && [ -n "${DB_PASSWORD:-}" ] && [ -n "${DB_NAME:-}" ]; then
    export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME}"
  fi

  if [ -n "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] Running database migrations…"
    MIGRATE_BIN="/app/node_modules/node-pg-migrate/bin/node-pg-migrate.js"
    node "${MIGRATE_BIN}" --migrations-dir migrations up
    node "${MIGRATE_BIN}" --migrations-dir migrations/modules/m1 --migrations-table pgmigrations_m1 up
    echo "[entrypoint] Migrations complete."
  else
    echo "[entrypoint] WARN: DATABASE_URL / DB_* not set — skipping migrations."
  fi
fi

exec "$@"
