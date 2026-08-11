#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER_NAME="nodeaccess-keycloak-cert"
KEYCLOAK_IMAGE="quay.io/keycloak/keycloak:26.7.0"
REALM_FILE="$REPO_ROOT/tools/oidc/keycloak-realm.json"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker run --detach --name "$CONTAINER_NAME" \
  --publish 127.0.0.1:18080:8080 \
  --env KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  --env KC_BOOTSTRAP_ADMIN_PASSWORD=nodeaccess-cert-admin \
  --volume "$REALM_FILE:/opt/keycloak/data/import/nodeaccess-cert-realm.json:ro" \
  "$KEYCLOAK_IMAGE" start-dev --import-realm --http-port=8080 >/dev/null

for _attempt in $(seq 1 120); do
  if curl --silent --fail "http://127.0.0.1:18080/realms/nodeaccess-cert/.well-known/openid-configuration" >/dev/null; then
    break
  fi
  sleep 1
done

curl --silent --fail "http://127.0.0.1:18080/realms/nodeaccess-cert/.well-known/openid-configuration" >/dev/null
npx tsx "$REPO_ROOT/tools/oidc/keycloak-certification.ts"

docker rm -f "$CONTAINER_NAME" >/dev/null
KEYCLOAK_EXPECT_OUTAGE=true npx tsx "$REPO_ROOT/tools/oidc/keycloak-certification.ts"
