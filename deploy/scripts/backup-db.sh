#!/usr/bin/env bash
# Daily PostgreSQL backup for Zedral production VM.
# Schedule: 0 2 * * * /opt/zedralv2/deploy/scripts/backup-db.sh >> /var/log/zedral-backup.log 2>&1
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

# shellcheck disable=SC1090
source "${ENV_FILE}"

DB_USER="${DB_USER:?DB_USER not set in deploy/.env}"
DB_NAME="${DB_NAME:?DB_NAME not set in deploy/.env}"

mkdir -p "${BACKUP_DIR}"
TIMESTAMP="$(date +%F_%H%M%S)"
OUTPUT="${BACKUP_DIR}/zedral_${DB_NAME}_${TIMESTAMP}.sql"

echo "[$(date -Is)] Starting backup → ${OUTPUT}"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T db \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-acl \
  > "${OUTPUT}"

gzip -f "${OUTPUT}"
ARCHIVE="${OUTPUT}.gz"
SIZE="$(du -h "${ARCHIVE}" | cut -f1)"
echo "[$(date -Is)] Backup complete (${SIZE}): ${ARCHIVE}"

# Optional off-VM copy (requires IAM role or AWS credentials on VM):
# aws s3 cp "${ARCHIVE}" "s3://${S3_BACKUP_BUCKET}/zedral/$(basename "${ARCHIVE}")"

find "${BACKUP_DIR}" -name 'zedral_*.sql.gz' -type f -mtime +"${RETENTION_DAYS}" -delete
echo "[$(date -Is)] Pruned backups older than ${RETENTION_DAYS} days"
