FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/platform/package.json packages/platform/
COPY packages/connectors/package.json packages/connectors/

RUN npm ci

COPY packages/platform packages/platform
COPY packages/connectors packages/connectors

RUN npm run build -w @zedral/platform -- --force && npm run build -w @zedral/connectors -- --force

FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/platform/package.json packages/platform/
COPY packages/connectors/package.json packages/connectors/

RUN npm ci --omit=dev --workspace @zedral/platform --workspace @zedral/connectors

COPY --from=builder /app/packages/platform/dist packages/platform/dist
COPY --from=builder /app/packages/connectors/dist packages/connectors/dist

WORKDIR /app/packages/connectors

CMD ["npm", "run", "start"]
