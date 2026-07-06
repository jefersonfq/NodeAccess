FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY apps/frontend/package*.json ./apps/frontend/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci --workspace=apps/frontend --workspace=packages/shared

# ── Dev ────────────────────────────────────────────────────────
FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "apps/frontend"]

# ── Build ──────────────────────────────────────────────────────
FROM base AS builder
COPY . .
RUN npm run build -w packages/shared
RUN npm run build -w apps/frontend

# ── Prod — serve estático via Nginx ───────────────────────────
FROM nginx:alpine AS prod
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY docker/nginx.https.conf /etc/nginx/nginx.conf
EXPOSE 80
