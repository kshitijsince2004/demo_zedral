#!/usr/bin/env bash
# Login the remote Docker daemon to GHCR without putting the token on the remote argv.
# Usage (from Actions): GHCR_TOKEN=… GHCR_USER=… bash deploy/scripts/remote-ghcr-login.sh user@host
set -euo pipefail

TARGET="${1:?usage: remote-ghcr-login.sh user@host}"
: "${GHCR_TOKEN:?GHCR_TOKEN required}"
: "${GHCR_USER:?GHCR_USER required}"

# Password via local stdin → remote docker login --password-stdin (never in ssh remote command string).
printf '%s' "${GHCR_TOKEN}" | ssh "${TARGET}" "docker login ghcr.io -u $(printf '%q' "${GHCR_USER}") --password-stdin"
echo "GHCR login OK on ${TARGET}"
