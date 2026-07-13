#!/usr/bin/env bash
# One-time AWS EC2 VM bootstrap (Ubuntu 22.04/24.04). Run as a user with sudo.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zedral}"
REPO_URL="${REPO_URL:-https://github.com/kshitijsince2004/hsl_zedral.git}"

echo "==> Setting up 4GB Swap file to prevent Out-Of-Memory errors on Free Tier..."
if [ ! -f /swapfile ]; then
  sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
else
  echo "Swap file already exists."
fi

echo "==> Installing Docker…"
sudo apt-get update -qq
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -qq
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER" || true

echo "==> Cloning application to $APP_DIR…"
sudo mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "Repo already exists at $APP_DIR"
elif [ -d "$APP_DIR/ZedralV2/.git" ]; then
  echo "Repo already exists at $APP_DIR/ZedralV2"
else
  if [ "$(ls -A "$APP_DIR" 2>/dev/null | wc -l)" -gt 0 ]; then
    sudo git clone "$REPO_URL" "$APP_DIR/ZedralV2"
  else
    sudo git clone "$REPO_URL" "$APP_DIR"
  fi
  sudo chown -R "$USER:$USER" "$APP_DIR"
fi

if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
elif [ -d "$APP_DIR/ZedralV2/.git" ]; then
  cd "$APP_DIR/ZedralV2"
else
  echo "ERROR: clone did not produce a .git directory under $APP_DIR"
  exit 1
fi
if [ ! -f deploy/.env ]; then
  cp deploy/.env.production.example deploy/.env
  echo "Created deploy/.env — edit JWT_SECRET and DB_PASSWORD before first deploy."
fi

echo ""
echo "Bootstrap complete. Next steps:"
echo "  1. Edit $APP_DIR/deploy/.env (JWT_SECRET, DB_PASSWORD, SUPERTOKENS_API_KEY)"
echo "  2. docker login ghcr.io -u <github-user>  (read:packages token)"
echo "  3. Leave BACKEND_IMAGE/NGINX_IMAGE empty — CI will set them on first Deploy AWS QA"
echo "  4. Optional one-time seed after first pull: docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec backend npm run seed:profiles"
echo "  5. Open AWS Security Group TCP 80 (and 443 if using TLS)"
echo "  See docs/CICD_PIPELINE.md — Build Once → Deploy Many (never docker compose build on the host)"
