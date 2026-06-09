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
    npx node-pg-migrate --migrations-dir migrations up
    echo "[entrypoint] Migrations complete."
  else
    echo "[entrypoint] WARN: DATABASE_URL / DB_* not set — skipping migrations."
  fi
fi

exec "$@"
