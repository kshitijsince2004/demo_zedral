#!/usr/bin/env bash
# One-time GitHub Actions self-hosted runner on the EC2 deploy VM.
# Avoids inbound SSH from GitHub-hosted runners (Security Group can stay locked down).
#
# Usage:
#   1. GitHub → repo → Settings → Actions → Runners → New self-hosted runner
#   2. Copy the registration token (valid ~1 hour)
#   3. On EC2:
#        export RUNNER_TOKEN='XXXXXXXX'
#        bash /opt/zedralv2/deploy/setup-github-runner.sh
#
# Optional env:
#   RUNNER_NAME   (default: zedral-ec2)
#   RUNNER_DIR    (default: /home/ubuntu/actions-runner)
#   REPO_URL      (default: https://github.com/kshitijsince2004/hsl_zedral)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kshitijsince2004/hsl_zedral}"
RUNNER_NAME="${RUNNER_NAME:-zedral-ec2}"
RUNNER_DIR="${RUNNER_DIR:-/home/ubuntu/actions-runner}"
RUNNER_LABELS="self-hosted,linux,x64,zedral"

if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo "ERROR: RUNNER_TOKEN is required."
  echo "GitHub → Settings → Actions → Runners → New self-hosted runner → copy token"
  exit 1
fi

if [ "$(id -un)" != "ubuntu" ]; then
  echo "WARN: run as ubuntu (current: $(id -un))"
fi

echo "==> Installing runner dependencies…"
sudo apt-get update -qq
sudo apt-get install -y curl jq libicu-dev

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
  echo "Runner already configured at ${RUNNER_DIR} — restarting service."
  sudo ./svc.sh status || true
  sudo ./svc.sh start || true
  exit 0
fi

echo "==> Registering runner ${RUNNER_NAME} for ${REPO_URL}…"
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
echo "Runner online. Workflow deploy-aws.yml uses: runs-on: [self-hosted, linux, zedral]"
echo "Verify in GitHub → Settings → Actions → Runners (should show Idle)."
