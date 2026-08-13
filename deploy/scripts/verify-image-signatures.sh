#!/usr/bin/env bash
# Verify GHCR image signatures (cosign). Default: WARN-ONLY.
# Set COSIGN_ENFORCE=1 to fail on missing/invalid signatures after a clean week.
set -euo pipefail

BACKEND_IMAGE="${BACKEND_IMAGE:?BACKEND_IMAGE required}"
NGINX_IMAGE="${NGINX_IMAGE:?NGINX_IMAGE required}"
ENFORCE="${COSIGN_ENFORCE:-0}"

if ! command -v cosign >/dev/null 2>&1; then
  echo "[verify-image-signatures] WARN: cosign not installed — skip"
  [ "${ENFORCE}" = "1" ] && exit 1
  exit 0
fi

verify_one() {
  local img="$1"
  if cosign verify --certificate-identity-regexp '.*' --certificate-oidc-issuer-regexp '.*' "${img}" >/dev/null 2>&1 \
    || cosign verify "${img}" >/dev/null 2>&1; then
    echo "[verify-image-signatures] OK: ${img}"
    return 0
  fi
  echo "[verify-image-signatures] WARN: unsigned or unverifiable: ${img}"
  return 1
}

failed=0
verify_one "${BACKEND_IMAGE}" || failed=1
verify_one "${NGINX_IMAGE}" || failed=1

if [ "${failed}" -ne 0 ]; then
  if [ "${ENFORCE}" = "1" ]; then
    echo "[verify-image-signatures] ENFORCE=1 — blocking deploy"
    exit 1
  fi
  echo "[verify-image-signatures] warn-only — continuing"
fi
exit 0
