#!/bin/sh
# ponytail: BACKEND_UPSTREAM for Render private host; resolver from resolv.conf outside Docker
set -eu
BACKEND_UPSTREAM="${BACKEND_UPSTREAM:-backend:3005}"
if [ -z "${NGINX_RESOLVER:-}" ]; then
  NGINX_RESOLVER="$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf 2>/dev/null || true)"
fi
NGINX_RESOLVER="${NGINX_RESOLVER:-127.0.0.11}"
export BACKEND_UPSTREAM NGINX_RESOLVER
# Only these two — leave nginx $host / $scheme / $uri alone.
envsubst '${BACKEND_UPSTREAM} ${NGINX_RESOLVER}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf
exec nginx -g 'daemon off;'
