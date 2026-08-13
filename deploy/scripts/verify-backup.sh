#!/usr/bin/env bash
# Verify latest encrypted backup archive is readable (run after backup-db.sh or from cron weekly).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/zedral}"
LATEST="$(find "${BACKUP_DIR}" -name 'zedral_*.sql.gz.age' -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"

if [ -z "${LATEST}" ]; then
  echo "ERROR: No encrypted backup files (*.sql.gz.age) found in ${BACKUP_DIR}" >&2
  exit 1
fi

if [ -z "${AGE_IDENTITY:-}" ] || [ ! -f "${AGE_IDENTITY}" ]; then
  echo "ERROR: AGE_IDENTITY must point to the off-box private key file for decrypt verify" >&2
  exit 1
fi
if ! command -v age >/dev/null 2>&1; then
  echo "ERROR: age not installed on PATH" >&2
  exit 1
fi

echo "Verifying ${LATEST} …"
TMP="$(mktemp)"
trap 'rm -f "${TMP}"' EXIT
age -d -i "${AGE_IDENTITY}" -o "${TMP}" "${LATEST}"
gzip -t "${TMP}"
LINES="$(zcat "${TMP}" 2>/dev/null | head -n 20 | wc -l || true)"
if [ "${LINES}" -lt 5 ]; then
  echo "ERROR: Backup appears empty or corrupt after decrypt" >&2
  exit 1
fi

echo "Backup verification passed ($(du -h "${LATEST}" | cut -f1))"
