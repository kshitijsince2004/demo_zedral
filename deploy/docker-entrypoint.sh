#!/bin/sh
set -eu

# Preserve runtime app URL (m1_app / RLS). Migrations must not leave the process on the bootstrap role.
APP_DATABASE_URL="${DATABASE_URL:-}"

# Build a postgres URL with percent-encoded user/password (passwords often contain @:#/).
pg_url() {
  U="$1" P="$2" H="$3" PORT="$4" N="$5" node -e "console.log(
    'postgres://' + encodeURIComponent(process.env.U) + ':' + encodeURIComponent(process.env.P) +
    '@' + process.env.H + ':' + process.env.PORT + '/' + process.env.N
  )"
}

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  MIGRATE_USER="${DB_MIGRATE_USER:-}"
  MIGRATE_PASSWORD="${DB_MIGRATE_PASSWORD:-}"
  APP_ROLE="${DB_APP_USER:-m1_app}"

  MIGRATE_URL=""
  # Prefer DB_MIGRATE_* (percent-encoded) over raw MIGRATE_DATABASE_URL (special chars in passwords).
  if [ -n "${DB_HOST:-}" ] && [ -n "${MIGRATE_USER}" ] && [ -n "${MIGRATE_PASSWORD}" ] && [ -n "${DB_NAME:-}" ]; then
    MIGRATE_URL="$(pg_url "${MIGRATE_USER}" "${MIGRATE_PASSWORD}" "${DB_HOST}" "${DB_PORT:-5432}" "${DB_NAME}")"
  elif [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
    MIGRATE_URL="${MIGRATE_DATABASE_URL}"
  fi

  if [ -n "${MIGRATE_URL}" ]; then
    # Refuse to migrate as the RLS app role (no CREATE on public → crash loop).
    MIGRATE_AS="$(
      U="${MIGRATE_URL}" node -e "
        try {
          const u = new URL(process.env.U);
          console.log(decodeURIComponent(u.username || ''));
        } catch {
          console.log('');
        }
      "
    )"
    if [ -z "${MIGRATE_AS}" ]; then
      echo "[entrypoint] ERROR: could not parse migrate user from MIGRATE_DATABASE_URL / DB_MIGRATE_*"
      exit 1
    fi
    if [ "${MIGRATE_AS}" = "${APP_ROLE}" ]; then
      echo "[entrypoint] ERROR: migrate user is '${MIGRATE_AS}' (app/RLS role) — need bootstrap owner (DB_USER in deploy/.env, e.g. m1_user)."
      echo "[entrypoint]        DB_MIGRATE_USER / MIGRATE_DATABASE_URL must NOT be ${APP_ROLE}."
      exit 1
    fi

    export DATABASE_URL="${MIGRATE_URL}"
    echo "[entrypoint] Running database migrations as ${MIGRATE_AS}…"
    MIGRATE_BIN="/app/node_modules/node-pg-migrate/bin/node-pg-migrate.js"
    node "${MIGRATE_BIN}" --migrations-dir migrations up
    node "${MIGRATE_BIN}" --migrations-dir migrations/modules/m1 --migrations-table pgmigrations_m1 up
    echo "[entrypoint] Migrations complete."

    if [ -n "${DB_APP_USER:-}" ] && [ -n "${DB_APP_PASSWORD:-}" ]; then
      # sync-app-role-password.mjs uses DATABASE_URL — must still be bootstrap here.
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
  export DATABASE_URL="$(pg_url "${DB_APP_USER}" "${DB_APP_PASSWORD}" "${DB_HOST}" "${DB_PORT:-5432}" "${DB_NAME}")"
fi

exec "$@"
