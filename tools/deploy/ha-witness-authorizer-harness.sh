#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

INSTALL_PATH="$TMP/bin/nodeaccess-ha-witness-authorize"
KEY_DIR="$TMP/keys"
OUTPUT_PREFIX="$TMP/evidence/switchover-test"
mkdir -p "$(dirname "$OUTPUT_PREFIX")"

echo "[nodeaccess] Cenário 1/3: instalação gera comando e par de chaves..."
WITNESS_INSTALL_PATH="$INSTALL_PATH" \
WITNESS_KEY_DIR="$KEY_DIR" \
  bash "$ROOT/scripts/deploy/install-ha-witness-authorizer.sh" >/dev/null

[[ -x "$INSTALL_PATH" ]]
[[ "$(stat -c '%a' "$KEY_DIR")" == "700" ]]
[[ "$(stat -c '%a' "$KEY_DIR/witness-private.pem")" == "600" ]]
[[ "$(stat -c '%a' "$KEY_DIR/witness-public.pem")" == "644" ]]

echo "[nodeaccess] Cenário 2/3: reinstalação preserva a chave privada..."
before="$(sha256sum "$KEY_DIR/witness-private.pem" | awk '{print $1}')"
WITNESS_INSTALL_PATH="$INSTALL_PATH" \
WITNESS_KEY_DIR="$KEY_DIR" \
  bash "$ROOT/scripts/deploy/install-ha-witness-authorizer.sh" >/dev/null
after="$(sha256sum "$KEY_DIR/witness-private.pem" | awk '{print $1}')"
[[ "$before" == "$after" ]]

echo "[nodeaccess] Cenário 3/3: comando simples emite evidência verificável..."
"$INSTALL_PATH" planned node-primary node-standby "$OUTPUT_PREFIX" \
  "$KEY_DIR/witness-private.pem" >/dev/null
grep -q '^contract=nodeaccess-ha-planned-switchover-v1$' "$OUTPUT_PREFIX.txt"
grep -q '^primary_node_id=node-primary$' "$OUTPUT_PREFIX.txt"
grep -q '^standby_node_id=node-standby$' "$OUTPUT_PREFIX.txt"
openssl dgst -sha256 \
  -verify "$KEY_DIR/witness-public.pem" \
  -signature "$OUTPUT_PREFIX.sig" \
  "$OUTPUT_PREFIX.txt" >/dev/null

echo "[ok] Harness do autorizador witness passou."
