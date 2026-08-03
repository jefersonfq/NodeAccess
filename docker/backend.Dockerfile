FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl python3 make g++
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY packages/shared/package*.json ./packages/shared/
RUN npm_config_build_from_source=true npm_config_nodedir=/usr/local \
  npm ci --no-audit --no-fund --fetch-retries=2 --fetch-timeout=30000 \
  --workspace=apps/backend --workspace=packages/shared

# ── Dev ────────────────────────────────────────────────────────
FROM base AS dev
COPY . .
RUN npm run db:generate -w apps/backend
CMD ["npm", "run", "dev", "-w", "apps/backend"]

# ── Build ──────────────────────────────────────────────────────
FROM base AS builder
COPY . .
RUN npm run db:generate -w apps/backend
RUN npm run build -w packages/shared
RUN npm run build -w apps/backend

# ── Prod ───────────────────────────────────────────────────────
FROM node:20-alpine AS prod
ARG APP_VERSION=dev
WORKDIR /app
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
RUN apk add --no-cache openssl
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/package*.json ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/node_modules ./node_modules
COPY --from=builder /app/apps/backend/prisma ./prisma
COPY --from=builder /app/apps/agent/dist ./agent/dist
COPY --from=builder /app/scripts/deploy/install-ha-agent.sh ./scripts/deploy/install-ha-agent.sh
COPY --from=builder /app/scripts/deploy/nodeaccess-ha-privileged-helper.sh ./scripts/deploy/nodeaccess-ha-privileged-helper.sh
CMD ["node", "dist/server.js"]
