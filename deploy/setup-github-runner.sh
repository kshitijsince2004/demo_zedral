#!/usr/bin/env bash
# One-time GitHub Actions self-hosted runner installer for a Zedral deploy VM.
# The runner lives ON the target server; deploy jobs then run docker/compose LOCALLY
# (no inbound SSH from GitHub). Keep the Security Group locked down (port 22 → ops IP only).
#
# Run this ONCE PER SERVER, giving each its own environment label:
#
#   AWS QA (staging) box:
#     export RUNNER_TOKEN='XXXX'
#     export RUNNER_ENV=aws-qa            # → labels: self-hosted,linux,x64,aws-qa
#     export RUNNER_NAME=zedral-aws-qa
#     bash /opt/zedral/deploy/setup-github-runner.sh
#
#   Factory (production) box:
#     export RUNNER_TOKEN='YYYY'
#     export RUNNER_ENV=factory           # → labels: self-hosted,linux,x64,factory
#     export RUNNER_NAME=zedral-factory
#     bash /opt/zedral/deploy/setup-github-runner.sh
#
# Get RUNNER_TOKEN from: GitHub → repo → Settings → Actions → Runners → New self-hosted runner
# (token is valid ~1 hour; generate a fresh one per box).
#
# Optional env:
#   RUNNER_DIR    (default: /home/ubuntu/actions-runner)
#   REPO_URL      (default: https://github.com/kshitijsince2004/hsl_zedral)
#   RUNNER_LABELS (default: self-hosted,linux,x64,${RUNNER_ENV}) — override to fully control labels
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kshitijsince2004/hsl_zedral}"
RUNNER_DIR="${RUNNER_DIR:-/home/ubuntu/actions-runner}"

RUNNER_ENV="${RUNNER_ENV:-}"
if [ -z "${RUNNER_ENV}" ] && [ -z "${RUNNER_LABELS:-}" ]; then
  echo "ERROR: set RUNNER_ENV=aws-qa (staging) or RUNNER_ENV=factory (production)."
  echo "       This becomes the runner label the deploy workflow matches on."
  exit 1
fi
RUNNER_NAME="${RUNNER_NAME:-zedral-${RUNNER_ENV:-runner}}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,x64,${RUNNER_ENV}}"

if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo "ERROR: RUNNER_TOKEN is required."
  echo "GitHub → Settings → Actions → Runners → New self-hosted runner → copy token"
  exit 1
fi

if [ "$(id -un)" != "ubuntu" ]; then
  echo "WARN: run as ubuntu (current: $(id -un))"
fi

# Deploy jobs run docker locally. Current-shell `groups` is stale until re-login;
# systemd only picks up `usermod -aG docker` after svc.sh stop/start.
if ! docker info >/dev/null 2>&1; then
  echo "==> Adding $(id -un) to group docker…"
  sudo usermod -aG docker "$(id -un)"
  if ! sg docker -c 'docker info' >/dev/null 2>&1; then
    echo "ERROR: docker daemon not reachable as $(id -un) after usermod."
    echo "  user=$(id -un) groups=$(id -Gn)"
    ls -l /var/run/docker.sock || true
    echo "  Fix: sudo usermod -aG docker $(id -un) && newgrp docker"
    echo "  Then restart the runner: cd ${RUNNER_DIR} && sudo ./svc.sh stop && sudo ./svc.sh start"
    exit 1
  fi
  echo "==> docker OK via group docker. Runner service restart (below) applies it to systemd."
fi

echo "==> Installing runner dependencies…"
sudo apt-get update -qq
sudo apt-get install -y curl jq libicu-dev rsync

echo "==> Downloading latest GitHub Actions runner…"
VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r '.tag_name' | sed 's/^v//')"
ARCHIVE="actions-runner-linux-x64-${VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/v${VERSION}/${ARCHIVE}"

mkdir -p "${RUNNER_DIR}"
cd "${RUNNER_DIR}"

if [ ! -f "./config.sh" ]; then
  curl -fsSLO "${URL}"
  tar xzf "${ARCHIVE}"
  rm -f "${ARCHIVE}"
fi

if [ -f "./.runner" ]; then
  echo "Runner already configured at ${RUNNER_DIR} — restarting service (picks up docker group)."
  sudo ./svc.sh stop || true
  sudo ./svc.sh start || true
  sudo ./svc.sh status || true
  exit 0
fi

echo "==> Registering runner ${RUNNER_NAME} (labels: ${RUNNER_LABELS}) for ${REPO_URL}…"
./config.sh \
  --url "${REPO_URL}" \
  --token "${RUNNER_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS}" \
  --unattended \
  --replace

echo "==> Installing systemd service…"
sudo ./svc.sh install ubuntu
sudo ./svc.sh start
sudo ./svc.sh status

echo ""
echo "Runner online with labels: ${RUNNER_LABELS}"
echo "  aws-qa  → matched by deploy-aws.yml        (runs-on: [self-hosted, linux, aws-qa])"
echo "  factory → matched by deploy-production.yml (runs-on: [self-hosted, linux, factory])"
echo "Verify in GitHub → Settings → Actions → Runners (should show Idle)."
echo "If deploy jobs hit docker.sock permission denied: sudo ./svc.sh stop && sudo ./svc.sh start"
