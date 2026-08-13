#!/bin/sh
set -eu

# Load Docker secrets from *_FILE into matching env vars (SAFE_CHANGE #16).
load_secret_file() {
  _var="$1"
  _file_var="${_var}_FILE"
  eval "_path=\${${_file_var}:-}"
  if [ -n "${_path}" ] && [ -f "${_path}" ]; then
    # shellcheck disable=SC2034
    _val="$(tr -d '\r\n' < "${_path}")"
    eval "export ${_var}=\"\${_val}\""
  fi
}

load_secret_file DB_APP_PASSWORD
load_secret_file DB_PASSWORD
# Prefer DB_APP_PASSWORD for runtime password when DB_PASSWORD unset
if [ -z "${DB_PASSWORD:-}" ] && [ -n "${DB_APP_PASSWORD:-}" ]; then
  export DB_PASSWORD="${DB_APP_PASSWORD}"
fi
load_secret_file DB_MIGRATE_PASSWORD
load_secret_file JWT_SECRET
load_secret_file SUPERTOKENS_API_KEY
load_secret_file SERVICE_TOKEN

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
  # Deploy path: remote-ghcr-deploy runs a discrete `compose run … migrate` before backend
  # starts with RUN_MIGRATIONS=false. This entrypoint path remains for one-shot / legacy boots.
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
    # --no-check-order: QA/prod DBs that ran past a later timestamp before mid-timeline
    # files existed (e.g. 193301 quality_spec_sheet vs already-run 193400) otherwise crash-loop.
    # Migrations use IF NOT EXISTS / idempotent DDL.
    node "${MIGRATE_BIN}" --migrations-dir migrations --no-check-order up
    node "${MIGRATE_BIN}" --migrations-dir migrations/modules/m1 --migrations-table pgmigrations_m1 --no-check-order up
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

if [ -z "${JWT_SECRET:-}" ]; then
  echo "[entrypoint] ERROR: JWT_SECRET not set (file /run/secrets/jwt_secret or env)"
  exit 1
fi
if [ -z "${DB_APP_PASSWORD:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] ERROR: DB_APP_PASSWORD / DATABASE_URL missing (secrets or env)"
  exit 1
fi

exec "$@"
