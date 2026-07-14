# ZedralV2 production image — multi-stage build
# Targets: backend (Node API), nginx (SPA + reverse proxy)

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/platform/package.json packages/platform/
COPY packages/connectors/package.json packages/connectors/
COPY packages/modules/m1-collection/package.json packages/modules/m1-collection/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/shared-validation/package.json packages/shared-validation/
COPY scripts/ensure-native-bindings.mjs scripts/ensure-native-bindings.mjs

# npm <11.3 can skip cross-OS optional natives from a Windows-generated lockfile.
RUN npm install -g npm@11.4.2 \
  && npm ci \
  && node scripts/ensure-native-bindings.mjs

COPY packages/shared-validation packages/shared-validation
COPY packages/platform packages/platform
COPY packages/connectors packages/connectors
COPY packages/modules/m1-collection packages/modules/m1-collection
COPY packages/server packages/server
COPY packages/client packages/client
COPY doc doc

RUN npm run build

# ── Backend runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine AS backend

RUN apk upgrade --no-cache && \
    apk add --no-cache curl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3005

COPY package.json package-lock.json ./
COPY packages/platform/package.json packages/platform/
COPY packages/connectors/package.json packages/connectors/
COPY packages/modules/m1-collection/package.json packages/modules/m1-collection/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/shared-validation/package.json packages/shared-validation/

RUN npm install -g npm@11.4.2 && npm ci --omit=dev --workspace=packages/server --include-workspace-root \
  && rm -rf node_modules/esbuild node_modules/@esbuild \
  && find node_modules -type d -name esbuild -prune -exec rm -rf {} + 2>/dev/null || true \
  && find node_modules -type d -name '@esbuild' -prune -exec rm -rf {} + 2>/dev/null || true \
  && find node_modules -path '*/esbuild/bin/esbuild' -delete 2>/dev/null || true

COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/shared-validation/dist packages/shared-validation/dist
COPY --from=builder /app/packages/platform/dist packages/platform/dist
COPY --from=builder /app/packages/modules/m1-collection/dist packages/modules/m1-collection/dist
COPY packages/server/migrations packages/server/migrations
COPY packages/server/scripts packages/server/scripts
COPY packages/server/assets packages/server/assets
COPY doc doc
COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

WORKDIR /app/packages/server

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:3005/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

# ── Nginx (SPA + /api proxy) ────────────────────────────────────────────────
FROM nginx:1.27-alpine AS nginx

RUN apk upgrade --no-cache

COPY deploy/nginx.prod.conf /etc/nginx/nginx.conf
COPY --from=builder /app/packages/client/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1
