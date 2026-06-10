#!/usr/bin/env bash
# Verify latest backup archive is readable (run after backup-db.sh or from cron weekly).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/zedral}"
LATEST="$(find "${BACKUP_DIR}" -name 'zedral_*.sql.gz' -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"

if [ -z "${LATEST}" ]; then
  echo "ERROR: No backup files found in ${BACKUP_DIR}" >&2
  exit 1
fi

echo "Verifying ${LATEST} …"
gzip -t "${LATEST}"
LINES="$(zcat "${LATEST}" | head -n 20 | wc -l)"
if [ "${LINES}" -lt 5 ]; then
  echo "ERROR: Backup appears empty or corrupt" >&2
  exit 1
fi

echo "Backup verification passed ($(du -h "${LATEST}" | cut -f1))"
