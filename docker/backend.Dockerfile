# Rebuild the same CLI release with the patched Go runtime (GO-2026-6859).
FROM golang:1.26.11-alpine3.24@sha256:ae52b5bc6ed045a9ed26ab03dc19327a802a9cc9aa8b27ed57f5c6b60579b0bb AS docker-cli
ADD --checksum=sha256:e3b1fab5e2ee2d6b63b8ce0e8bbd08d6f54c0537c470332f2c345ab997233409 https://codeload.github.com/docker/cli/tar.gz/refs/tags/v29.9.2 /tmp/docker-cli.tar.gz
WORKDIR /go/src/github.com/docker/cli
RUN tar -xzf /tmp/docker-cli.tar.gz --strip-components=1 && rm /tmp/docker-cli.tar.gz
# Vendored release dependencies only; no downloads or toolchain switching during compilation.
RUN --network=none CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=off GOFLAGS=-trimpath \
    VERSION=29.9.2 GITCOMMIT=v29.9.2-source GO_STRIP=1 \
    sh scripts/build/binary \
    && cp build/docker /usr/local/bin/docker

FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base
WORKDIR /app
# Docker CLI is needed inside the API container by the observability collector.
# The release CLI is rebuilt with patched Go; daemon access stays deployment-controlled.
RUN sed -i 's/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g' /etc/apk/repositories \
  && apk --timeout 30 upgrade --no-cache && apk --timeout 30 add --no-cache openssl "zlib>=1.4-r0" python3 make g++
COPY --from=docker-cli /usr/local/bin/docker /usr/bin/docker
COPY package*.json ./
COPY scripts/dependency-patches/typedoc-minimatch.mjs ./scripts/dependency-patches/typedoc-minimatch.mjs
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
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS runtime
ARG APP_VERSION=dev
WORKDIR /app
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
RUN sed -i 's/dl-cdn.alpinelinux.org/dl-4.alpinelinux.org/g' /etc/apk/repositories \
  && apk --timeout 30 upgrade --no-cache && apk --timeout 30 add --no-cache openssl "zlib>=1.4-r0"
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
