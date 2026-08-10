FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY apps/frontend/package*.json ./apps/frontend/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci --no-audit --no-fund --workspace=apps/frontend --workspace=packages/shared

# ── Dev ────────────────────────────────────────────────────────
FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "apps/frontend"]

# ── Build ──────────────────────────────────────────────────────
FROM base AS builder
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
COPY . .
RUN npm run build -w packages/shared
RUN npm run build -w apps/frontend

# ── Prod — serve estático via Nginx ───────────────────────────
FROM nginx:alpine AS prod
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version="${APP_VERSION}"
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY docker/nginx.https.conf /etc/nginx/nginx.conf
EXPOSE 80

# ── Kubernetes — HTTP neutro atrás de Ingress ─────────────────
# Mantém o target `prod` intacto para instalações Docker existentes.
FROM nginxinc/nginx-unprivileged:alpine AS prod-k8s
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version="${APP_VERSION}"
ENV API_UPSTREAM=api:3000
ENV GATEWAY_UPSTREAM=ssh-gateway:3001
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY docker/nginx.k8s.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
