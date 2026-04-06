FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci --workspace=apps/backend --workspace=packages/shared

# ── Dev ────────────────────────────────────────────────────────
FROM base AS dev
COPY . .
RUN npm run db:generate -w apps/backend
CMD ["npm", "run", "dev", "-w", "apps/backend"]

# ── Build ──────────────────────────────────────────────────────
FROM base AS builder
COPY . .
RUN npm run build -w packages/shared
RUN npm run build -w apps/backend

# ── Prod ───────────────────────────────────────────────────────
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/prisma ./prisma
CMD ["node", "dist/server.js"]