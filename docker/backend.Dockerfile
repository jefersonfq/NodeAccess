FROM docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb AS docker-cli

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
WORKDIR /app
# Docker CLI is needed inside the API container by the observability collector.
# The official CLI is built with patched Go; daemon access stays deployment-controlled.
RUN sed -i 's/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g' /etc/apk/repositories \
  && apk --timeout 30 upgrade --no-cache && apk --timeout 30 add --no-cache openssl python3 make g++
COPY --from=docker-cli /usr/local/bin/docker /usr/bin/docker
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
# npm prune rewrites lock metadata; signed agent provenance uses the source lock.
RUN cp package-lock.json /tmp/nodeaccess-source-package-lock.json \
  && npm prune --omit=dev --no-audit --no-fund --workspace=apps/backend --workspace=packages/shared \
  && mv /tmp/nodeaccess-source-package-lock.json package-lock.json \
  && mkdir -p /runtime-node_modules \
  && cp -a node_modules/. /runtime-node_modules/ \
  && if [ -d apps/backend/node_modules ]; then cp -a apps/backend/node_modules/. /runtime-node_modules/; fi

# Release artifacts are independently verified; this stage is mandatory for prod.
# The runtime stage below lets CI exercise the actual API without a signing key.
FROM builder AS release-artifacts
RUN --mount=type=secret,id=nodeaccess_release_public_key,required=true \
  NODEACCESS_RELEASE_PUBLIC_KEY=/run/secrets/nodeaccess_release_public_key \
  node scripts/release/validate-agents.mjs

# ── Prod ───────────────────────────────────────────────────────
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
ARG APP_VERSION=dev
WORKDIR /app
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
RUN sed -i 's/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g' /etc/apk/repositories \
  && apk --timeout 30 upgrade --no-cache && apk --timeout 30 add --no-cache openssl
COPY --from=docker-cli /usr/local/bin/docker /usr/bin/docker
# Runtime executes the installed Prisma CLI directly; package managers belong to build stages.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/package*.json ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /runtime-node_modules ./node_modules
COPY --from=builder /app/apps/backend/prisma ./prisma
COPY --from=builder /app/scripts/deploy/install-ha-agent.sh ./scripts/deploy/install-ha-agent.sh
COPY --from=builder /app/scripts/deploy/nodeaccess-ha-privileged-helper.sh ./scripts/deploy/nodeaccess-ha-privileged-helper.sh
CMD ["node", "dist/server.js"]

FROM runtime AS prod
COPY --from=release-artifacts /app/apps/agent/dist ./agent/dist
