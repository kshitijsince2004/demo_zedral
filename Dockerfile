# ZedralV2 production image — multi-stage build
# Targets: backend (Node API), nginx (SPA + reverse proxy)

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/shared-validation/package.json packages/shared-validation/

RUN npm ci

COPY packages/shared-validation packages/shared-validation
COPY packages/server packages/server
COPY packages/client packages/client
COPY doc doc

RUN npm run build

# ── Backend runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine AS backend

RUN apk add --no-cache curl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3005

COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/shared-validation/package.json packages/shared-validation/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/shared-validation/dist packages/shared-validation/dist
COPY packages/server/migrations packages/server/migrations
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

COPY deploy/nginx.prod.conf /etc/nginx/nginx.conf
COPY --from=builder /app/packages/client/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1
