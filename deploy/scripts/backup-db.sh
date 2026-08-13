#!/usr/bin/env bash
# Daily PostgreSQL backup for Zedral production VM.
# Schedule: 0 2 * * * /opt/zedral/deploy/scripts/backup-db.sh >> /var/log/zedral-backup.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.prod.yml"
ENV_FILE="${REPO_ROOT}/deploy/.env"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/zedral}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found" >&2
  exit 1
fi

  while IFS='=' read -r key value || [ -n "$key" ]; do
    key="$(echo -n "$key" | xargs)"
    key="${key#export }"
    if [[ -z "$key" ]] || [[ "$key" == \#* ]]; then continue; fi
    value="${value%$'\r'}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    export "$key=$value"
  done < "${ENV_FILE}"

DB_USER="${DB_USER:?DB_USER not set in deploy/.env}"
DB_NAME="${DB_NAME:?DB_NAME not set in deploy/.env}"

if [ ! -w "${BACKUP_DIR}" ]; then
  # If we don't have write access (e.g. self-hosted runner trying to write to /var/backups),
  # attempt to create it and take ownership via sudo.
  sudo mkdir -p "${BACKUP_DIR}" 2>/dev/null || true
  sudo chown -R "$(whoami)":"$(whoami)" "${BACKUP_DIR}" 2>/dev/null || true
fi
mkdir -p "${BACKUP_DIR}"
TIMESTAMP="$(date +%F_%H%M%S)"
OUTPUT="${BACKUP_DIR}/zedral_${DB_NAME}_${TIMESTAMP}.sql"

echo "[$(date -Is)] Starting backup → ${OUTPUT}"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T db \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-acl \
  > "${OUTPUT}"

gzip -f "${OUTPUT}"
PLAIN_ARCHIVE="${OUTPUT}.gz"

# Encrypt with age using an off-box public recipient (private key never on the VM).
# Set AGE_RECIPIENT in deploy/.env (age1...). Install: https://github.com/FiloSottile/age
if [ -z "${AGE_RECIPIENT:-}" ]; then
  echo "ERROR: AGE_RECIPIENT not set — refusing to leave plaintext backup on disk" >&2
  rm -f "${PLAIN_ARCHIVE}"
  exit 1
fi
if ! command -v age >/dev/null 2>&1; then
  echo "ERROR: age not installed on PATH" >&2
  rm -f "${PLAIN_ARCHIVE}"
  exit 1
fi
ARCHIVE="${PLAIN_ARCHIVE}.age"
age -r "${AGE_RECIPIENT}" -o "${ARCHIVE}" "${PLAIN_ARCHIVE}"
rm -f "${PLAIN_ARCHIVE}"
SIZE="$(du -h "${ARCHIVE}" | cut -f1)"
echo "[$(date -Is)] Backup complete (${SIZE}): ${ARCHIVE}"

# Optional off-VM copy (requires IAM role or AWS credentials on VM):
# Encrypt-before-upload already done; upload the .age only:
# aws s3 cp "${ARCHIVE}" "s3://${S3_BACKUP_BUCKET}/zedral/$(basename "${ARCHIVE}")"

find "${BACKUP_DIR}" -name 'zedral_*.sql.gz.age' -type f -mtime +"${RETENTION_DAYS}" -delete
echo "[$(date -Is)] Pruned encrypted backups older than ${RETENTION_DAYS} days"
