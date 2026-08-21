# ZedralV2 production image — multi-stage build
# Targets: backend (Node API), nginx (SPA + reverse proxy)

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY vendor/xlsx-0.20.3.tgz vendor/
COPY packages/platform/package.json packages/platform/
COPY packages/connectors/package.json packages/connectors/
COPY packages/modules/m1-collection/package.json packages/modules/m1-collection/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/shared-validation/package.json packages/shared-validation/
COPY scripts/ensure-native-bindings.mjs scripts/ensure-native-bindings.mjs

# Drop nested nodemailer <9 (supertokens / prune can reintroduce 8.x; Trivy HIGH).
COPY scripts/purge-nodemailer-lt9.mjs scripts/purge-nodemailer-lt9.mjs

# Puppeteer is optionalDependencies for PDF export; PdfRenderer falls back to HTML
# when Chromium is absent. Skip the ~150–300MB download to keep GHCR pulls small.
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# npm pin: keep in sync with root package.json "packageManager" and
# .github/actions/setup-node-npm (npm <11.3 skips cross-OS optional natives).
RUN npm install -g npm@11.4.2 \
  && npm ci \
  && node scripts/ensure-native-bindings.mjs \
  && node scripts/purge-nodemailer-lt9.mjs

COPY packages/shared-validation packages/shared-validation
COPY packages/platform packages/platform
COPY packages/connectors packages/connectors
COPY packages/modules/m1-collection packages/modules/m1-collection
COPY packages/server packages/server
COPY packages/client packages/client
COPY doc doc

RUN npm run build

# ── Production node_modules (prune the full workspace install) ────────────────
# Do NOT run a second `npm ci --omit=dev --workspace=…` here: the lockfile can mark
# a conflicting zod@4 at the root as "dev" while zod@3 is nested; omit=dev then
# drops require('zod') entirely (chromium-bidi may keep a private copy Node cannot see).
FROM builder AS prod-deps
WORKDIR /app
# --ignore-scripts: prune must not re-run nested esbuild installers (tsx wants 0.28,
# root optionalDeps pin 0.21.5) — binaries already present from builder npm ci.
RUN npm prune --omit=dev --ignore-scripts \
  && node scripts/purge-nodemailer-lt9.mjs \
  && rm -rf packages/client \
  && node -e "process.chdir('packages/server'); \
       ['zod','pg','express'].forEach((m) => require.resolve(m)); \
       console.log('prod-deps ok', require('zod/package.json').version, require.resolve('zod'));"

# ── Backend runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine AS backend

RUN apk upgrade --no-cache && \
    apk add --no-cache curl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3005

COPY --from=prod-deps /app/package.json /app/package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
# Dist-only runtime (no src/tests/doc) — mirror deploy/connectors/Dockerfile.
COPY --from=prod-deps /app/packages/platform/package.json ./packages/platform/package.json
COPY --from=prod-deps /app/packages/platform/dist ./packages/platform/dist
COPY --from=prod-deps /app/packages/connectors/package.json ./packages/connectors/package.json
COPY --from=prod-deps /app/packages/connectors/dist ./packages/connectors/dist
COPY --from=prod-deps /app/packages/modules/m1-collection/package.json ./packages/modules/m1-collection/package.json
COPY --from=prod-deps /app/packages/modules/m1-collection/dist ./packages/modules/m1-collection/dist
COPY --from=prod-deps /app/packages/shared-validation/package.json ./packages/shared-validation/package.json
COPY --from=prod-deps /app/packages/shared-validation/dist ./packages/shared-validation/dist
COPY --from=prod-deps /app/packages/server/package.json ./packages/server/package.json
COPY --from=prod-deps /app/packages/server/dist ./packages/server/dist
COPY --from=prod-deps /app/packages/server/migrations ./packages/server/migrations
COPY --from=prod-deps /app/packages/server/scripts ./packages/server/scripts
COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh

# Trivy flags CVE-2026-59873 in npm's bundled tar (entrypoint runs node directly).
RUN chmod +x /docker-entrypoint.sh \
  && node -e "process.chdir('packages/server'); require('zod'); require('pg'); require('express'); \
       const v=require('nodemailer/package.json').version; \
       if(!String(v).startsWith('9.')) { console.error('nodemailer must be 9.x, got', v); process.exit(1); } \
       console.log('runtime image ok', 'nodemailer', v);" \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app/packages/server

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:3005/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

# ── Nginx (SPA + /api proxy) ────────────────────────────────────────────────
# PERF-F1: alpine nginx + nginx-mod-http-brotli (official nginx:alpine ABI-mismatches the alpine brotli module)
FROM alpine:3.21 AS nginx

RUN apk upgrade --no-cache && \
    apk add --no-cache nginx nginx-mod-http-brotli wget gettext

COPY deploy/nginx.prod.conf /etc/nginx/nginx.conf.template
COPY deploy/nginx-entrypoint.sh /nginx-entrypoint.sh
COPY --from=builder /app/packages/client/dist /usr/share/nginx/html

RUN chmod +x /nginx-entrypoint.sh

# Compose default; Render: BACKEND_UPSTREAM=<api-service-name>:<PORT>
ENV BACKEND_UPSTREAM=backend:3005
# Empty → entrypoint reads /etc/resolv.conf (Docker usually already has 127.0.0.11)
ENV NGINX_RESOLVER=

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1

CMD ["/nginx-entrypoint.sh"]
