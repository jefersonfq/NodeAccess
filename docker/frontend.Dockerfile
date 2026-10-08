FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS node-runtime
FROM node-runtime AS base
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
FROM nginx:1.30.5-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS prod
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version="${APP_VERSION}"
RUN apk --no-network del nginx-module-image-filter \
  && apk --timeout 30 upgrade --no-cache
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY docker/nginx.https.conf /etc/nginx/nginx.conf
EXPOSE 80

# ── Kubernetes — HTTP neutro atrás de Ingress ─────────────────
# Mantém o target `prod` intacto para instalações Docker existentes.
FROM nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3 AS prod-k8s
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version="${APP_VERSION}"
USER root
RUN apk --no-network del nginx-module-image-filter \
  && apk --timeout 30 upgrade --no-cache
USER 101
ENV API_UPSTREAM=api:3000
ENV GATEWAY_UPSTREAM=ssh-gateway:3001
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY docker/nginx.k8s.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080

# Optional certificate worker. Same Nginx base as prod; no frontend assets needed.
FROM nginx:1.30.5-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS tls-agent
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version="${APP_VERSION}"
COPY docker/tls-requirements.txt /tmp/tls-requirements.txt
RUN apk --no-network del nginx-module-image-filter \
  && apk --timeout 30 upgrade --no-cache \
  && apk --timeout 30 add --no-cache libstdc++ python3 openssl ca-certificates \
  && apk --timeout 30 add --no-cache --virtual .certbot-build py3-pip \
  && python3 -m venv --without-pip /opt/certbot \
  && python3 -m pip --python /opt/certbot/bin/python install --no-cache-dir --only-binary=:all: -r /tmp/tls-requirements.txt \
  && apk --no-network del .certbot-build \
  && rm /tmp/tls-requirements.txt
ENV PATH="/opt/certbot/bin:${PATH}"
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY docker/nginx.https.conf /etc/nginx/nginx.conf
COPY tools/tls /opt/nodeaccess-tls
STOPSIGNAL SIGTERM
ENTRYPOINT ["sh", "/opt/nodeaccess-tls/entrypoint.sh"]
