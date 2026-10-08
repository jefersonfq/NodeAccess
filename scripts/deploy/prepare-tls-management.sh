#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${TLS_DOMAIN:?Informe TLS_DOMAIN (domínio público desta instalação)}"
TLS_AGENT_IMAGE="${TLS_AGENT_IMAGE:-nodeaccess-tls-agent:0.1.0}"
TLS_EXTERNAL="${TLS_EXTERNAL:-false}"
NGINX_SOURCE="${NGINX_SOURCE:-$PROJECT_ROOT/docker/nginx.https.conf}"
if [[ "$TLS_EXTERNAL" == true ]]; then NGINX_SOURCE="${NGINX_SOURCE_OVERRIDE:-$PROJECT_ROOT/docker/nginx.http.conf}"; fi
mkdir -p "$PROJECT_ROOT/certs"
docker run --rm --entrypoint node \
  -e TLS_DOMAIN -e TLS_EXTERNAL="$TLS_EXTERNAL" \
  -v "$PROJECT_ROOT/certs:/etc/nginx/certs" \
  -v "$NGINX_SOURCE:/input/nginx.conf:ro" \
  -v "$PROJECT_ROOT/docker:/output" \
  "$TLS_AGENT_IMAGE" /opt/nodeaccess-tls/prepare.mjs
printf '%s\n' 'Preparado. Configure TLS_MANAGEMENT_ENABLED=true, TLS_DOMAIN e TLS_AGENT_IMAGE no .env e execute o instalador/atualizador.'
