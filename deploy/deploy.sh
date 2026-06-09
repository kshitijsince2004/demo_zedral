#!/usr/bin/env bash
# Pull latest code and restart production stack on the VM.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/.env}"
COMPOSE_FILE="$ROOT_DIR/deploy/docker-compose.prod.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy deploy/.env.production.example to deploy/.env"
  exit 1
fi

cd "$ROOT_DIR"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo "==> Building and starting ZedralV2 production stack…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --remove-orphans

echo "==> Waiting for health…"
sleep 8
curl -fsS "http://localhost:${HTTP_PORT:-80}/health" | head -c 200 || {
  echo "Health check failed — inspect: docker compose -f $COMPOSE_FILE logs backend nginx"
  exit 1
}

echo ""
echo "Deploy complete."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
