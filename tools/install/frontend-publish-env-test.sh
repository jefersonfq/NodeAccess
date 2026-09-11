#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

make_env() {
  local target="$1"
  cp "$PROJECT_ROOT/.env.example.prod" "$target"
  sed -i \
    -e 's|replace_with_64_hex_chars|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef|' \
    "$target"
}

expect_invalid() {
  local env_file="$1"
  if bash "$PROJECT_ROOT/scripts/install/validate-env.sh" "$env_file" >/dev/null 2>&1; then
    echo "Falha: configuracao invalida foi aceita: $env_file" >&2
    exit 1
  fi
}

DIRECT_ENV="$TMP_DIR/direct.env"
PROXY_ENV="$TMP_DIR/proxy.env"
INVALID_ENV="$TMP_DIR/invalid.env"
make_env "$DIRECT_ENV"
make_env "$PROXY_ENV"

sed -i \
  -e 's|TLS_MODE=provided|TLS_MODE=off|' \
  -e 's|NGINX_CONFIG_FILE=./docker/nginx.https.conf|NGINX_CONFIG_FILE=./docker/nginx.http.conf|' \
  -e 's|NODEACCESS_BIND_ADDRESS=0.0.0.0|NODEACCESS_BIND_ADDRESS=127.0.0.1|' \
  -e 's|NODEACCESS_HTTP_PORT=80|NODEACCESS_HTTP_PORT=8080|' \
  -e 's|NODEACCESS_HTTPS_PORT=443|NODEACCESS_HTTPS_PORT=8443|' \
  -e 's|NODEACCESS_BEHIND_REVERSE_PROXY=false|NODEACCESS_BEHIND_REVERSE_PROXY=true|' \
  "$PROXY_ENV"

bash "$PROJECT_ROOT/scripts/install/validate-env.sh" "$DIRECT_ENV" >/dev/null
bash "$PROJECT_ROOT/scripts/install/validate-env.sh" "$PROXY_ENV" >/dev/null

cp "$PROXY_ENV" "$INVALID_ENV"
sed -i 's|NODEACCESS_BIND_ADDRESS=127.0.0.1|NODEACCESS_BIND_ADDRESS=0.0.0.0|' "$INVALID_ENV"
expect_invalid "$INVALID_ENV"

INVALID_PORT_ENV="$TMP_DIR/invalid-port.env"
cp "$DIRECT_ENV" "$INVALID_PORT_ENV"
sed -i 's|NODEACCESS_HTTP_PORT=80|NODEACCESS_HTTP_PORT=3000|' "$INVALID_PORT_ENV"
expect_invalid "$INVALID_PORT_ENV"

INVALID_TLS_ENV="$TMP_DIR/invalid-proxy-tls.env"
cp "$PROXY_ENV" "$INVALID_TLS_ENV"
sed -i 's|TLS_MODE=off|TLS_MODE=provided|' "$INVALID_TLS_ENV"
expect_invalid "$INVALID_TLS_ENV"

compose_output="$(
  cd "$PROJECT_ROOT"
  docker compose -f docker-compose.prod.yml --env-file "$PROXY_ENV" config
)"
grep -q 'host_ip: 127.0.0.1' <<<"$compose_output"
grep -q 'published: "8080"' <<<"$compose_output"
grep -q 'published: "8443"' <<<"$compose_output"
grep -q 'docker/nginx.http.conf' <<<"$compose_output"

ha_compose_output="$(
  cd "$PROJECT_ROOT"
  SESSION_AUDIT_HOST_DIR=/tmp/nodeaccess-test-audit \
  USER_AVATAR_HOST_DIR=/tmp/nodeaccess-test-avatars \
    docker compose -f docker-compose.ha.yml --env-file "$PROXY_ENV" config
)"
grep -q 'host_ip: 127.0.0.1' <<<"$ha_compose_output"
grep -q 'published: "8080"' <<<"$ha_compose_output"
grep -q 'published: "8443"' <<<"$ha_compose_output"

echo "Frontend publish env: cenarios direto, proxy externo e rejeicao segura aprovados."
