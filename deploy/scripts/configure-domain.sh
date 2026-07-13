#!/usr/bin/env bash
# Configure Zedral for a public domain (e.g. hsl.zedral.com) on AWS EC2.
#
# Usage:
#   cd /opt/zedral
#   sudo bash deploy/scripts/configure-domain.sh hsl.zedral.com
#   sudo bash deploy/scripts/configure-domain.sh hsl.zedral.com --tls   # HTTPS via Let's Encrypt
#
# Prerequisites:
#   - DNS A record: hsl.zedral.com → EC2 Elastic IP
#   - Security Group: TCP 80 (+ 443 for --tls)
set -euo pipefail

DOMAIN="${1:-}"
ENABLE_TLS=false
if [ "${2:-}" = "--tls" ]; then
  ENABLE_TLS=true
fi

if [ -z "${DOMAIN}" ]; then
  echo "Usage: sudo bash deploy/scripts/configure-domain.sh <domain> [--tls]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/deploy/.env"
COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.prod.yml"
PUBLIC_URL="https://${DOMAIN}"

if [ "${ENABLE_TLS}" = false ]; then
  PUBLIC_URL="http://${DOMAIN}"
fi

[ -f "${ENV_FILE}" ] || { echo "Missing ${ENV_FILE}" >&2; exit 1; }

# Web SPA + API same origin; include Capacitor origins for operator APK.
CORS_VALUE="${PUBLIC_URL},https://localhost,capacitor://localhost"

set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "${ENV_FILE}"
  else
    echo "${key}=${val}" >> "${ENV_FILE}"
  fi
}

echo "==> Configuring domain: ${DOMAIN}"
echo "    Public URL: ${PUBLIC_URL}"

set_env "CORS_ORIGIN" "${CORS_VALUE}"
set_env "PUBLIC_DOMAIN" "${DOMAIN}"

if [ "${ENABLE_TLS}" = true ]; then
  set_env "DOCKER_HTTP_BIND" "127.0.0.1:8080"
  echo "==> Docker nginx will listen on 127.0.0.1:8080 (host nginx terminates TLS)"
else
  set_env "DOCKER_HTTP_BIND" "0.0.0.0:80"
fi

cd "${REPO_ROOT}"
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" restart backend

if [ "${ENABLE_TLS}" = true ]; then
  echo "==> Installing host nginx + certbot…"
  apt-get update -qq
  apt-get install -y nginx certbot python3-certbot-nginx

  HOST_CONF="/etc/nginx/sites-available/zedral-${DOMAIN}"
  sed "s/hsl.zedral.com/${DOMAIN}/g" "${REPO_ROOT}/deploy/nginx/host-hsl.zedral.com.conf" > "${HOST_CONF}"
  ln -sf "${HOST_CONF}" "/etc/nginx/sites-enabled/zedral-${DOMAIN}"
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

  mkdir -p /var/www/certbot
  nginx -t

  if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    echo "==> Obtaining Let's Encrypt certificate for ${DOMAIN}…"
    systemctl stop nginx 2>/dev/null || true
    certbot certonly --standalone -d "${DOMAIN}" --non-interactive --agree-tos \
      -m "${CERTBOT_EMAIL:-admin@${DOMAIN}}" || {
      echo "Certbot failed — ensure DNS points to this server and port 80 is open." >&2
      exit 1
    }
    systemctl start nginx
  fi

  nginx -t
  systemctl enable nginx
  systemctl reload nginx
  echo "==> TLS enabled — verify: curl -I https://${DOMAIN}/health"
fi

echo ""
echo "=============================================="
echo "  Domain configuration complete"
echo "=============================================="
echo "  App URL:     ${PUBLIC_URL}"
echo "  CORS_ORIGIN: ${CORS_VALUE}"
echo ""
echo "  GitHub secret AWS_PUBLIC_URL=${PUBLIC_URL}"
echo ""
echo "  Operator APK (packages/client/.env.operator):"
echo "    VITE_API_URL=${PUBLIC_URL}"
echo ""
echo "  Seed users (if not done):"
echo "    SEED_PIN='your-pin' bash deploy/scripts/post-deploy-setup.sh"
echo "=============================================="
