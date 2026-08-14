#!/usr/bin/env bash
# Verify latest backup archive (encrypted .age when AGE_IDENTITY is present, else gzip).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/zedral}"

latest_named() {
  local glob="$1"
  find "${BACKUP_DIR}" -name "${glob}" -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-
}

verify_gzip_file() {
  local file="$1"
  gzip -t "${file}"
  local lines
  lines="$(zcat "${file}" 2>/dev/null | head -n 20 | wc -l || true)"
  if [ "${lines}" -lt 5 ]; then
    echo "ERROR: Backup appears empty or corrupt: ${file}" >&2
    exit 1
  fi
  echo "Backup verification passed ($(du -h "${file}" | cut -f1)): ${file}"
}

AGE_LATEST="$(latest_named 'zedral_*.sql.gz.age')"
GZ_LATEST="$(latest_named 'zedral_*.sql.gz')"

if [ -n "${AGE_IDENTITY:-}" ] && [ -f "${AGE_IDENTITY}" ] && [ -n "${AGE_LATEST}" ]; then
  if ! command -v age >/dev/null 2>&1; then
    echo "ERROR: age not installed on PATH" >&2
    exit 1
  fi
  echo "Verifying ${AGE_LATEST} …"
  TMP="$(mktemp)"
  trap 'rm -f "${TMP}"' EXIT
  age -d -i "${AGE_IDENTITY}" -o "${TMP}" "${AGE_LATEST}"
  gzip -t "${TMP}"
  LINES="$(zcat "${TMP}" 2>/dev/null | head -n 20 | wc -l || true)"
  if [ "${LINES}" -lt 5 ]; then
    echo "ERROR: Backup appears empty or corrupt after decrypt" >&2
    exit 1
  fi
  echo "Backup verification passed ($(du -h "${AGE_LATEST}" | cut -f1))"
  exit 0
fi

if [ -n "${GZ_LATEST}" ]; then
  echo "Verifying ${GZ_LATEST} (gzip; AGE_IDENTITY not set — plant cannot decrypt .age) …"
  verify_gzip_file "${GZ_LATEST}"
  exit 0
fi

echo "ERROR: No backup files (*.sql.gz or *.sql.gz.age) found in ${BACKUP_DIR}" >&2
exit 1
