#!/usr/bin/env bash
# One-time GCP VM bootstrap (Ubuntu 22.04/24.04). Run as a user with sudo.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/zedralv2}"
REPO_URL="${REPO_URL:-https://github.com/YOUR_ORG/ZedralV2.git}"

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
sudo mkdir -p "$(dirname "$APP_DIR")"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo git clone "$REPO_URL" "$APP_DIR"
  sudo chown -R "$USER:$USER" "$APP_DIR"
else
  echo "Repo already exists at $APP_DIR"
fi

cd "$APP_DIR"
if [ ! -f deploy/.env ]; then
  cp deploy/.env.production.example deploy/.env
  echo "Created deploy/.env — edit JWT_SECRET and DB_PASSWORD before first deploy."
fi

echo ""
echo "Bootstrap complete. Next steps:"
echo "  1. Edit $APP_DIR/deploy/.env (JWT_SECRET, DB_PASSWORD)"
echo "  2. bash $APP_DIR/deploy/deploy.sh"
echo "  3. Optional one-time seed: docker compose -f deploy/docker-compose.prod.yml exec backend npm run seed:admin"
echo "  4. Open firewall TCP 80 (and 443 if using TLS)"
