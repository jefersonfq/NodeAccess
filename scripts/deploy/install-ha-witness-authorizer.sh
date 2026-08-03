#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_PATH="${WITNESS_INSTALL_PATH:-/usr/local/sbin/nodeaccess-ha-witness-authorize}"
KEY_DIR="${WITNESS_KEY_DIR:-/var/lib/nodeaccess-ha-witness/keys}"
ISSUER_SOURCE="${SCRIPT_DIR}/ha-witness-issue-evidence.sh"
KEYGEN_SOURCE="${SCRIPT_DIR}/ha-witness-keygen.sh"

[[ -f "$ISSUER_SOURCE" && -f "$KEYGEN_SOURCE" ]] || {
  echo "[fail] Execute este instalador a partir do pacote NodeAccess completo." >&2
  exit 1
}
command -v install >/dev/null 2>&1 || {
  echo "[fail] Comando install não encontrado." >&2
  exit 1
}

install -d -m 0755 "$(dirname "$INSTALL_PATH")"
install -m 0755 "$ISSUER_SOURCE" "$INSTALL_PATH"

if [[ ! -f "$KEY_DIR/witness-private.pem" || ! -f "$KEY_DIR/witness-public.pem" ]]; then
  if [[ -e "$KEY_DIR/witness-private.pem" || -e "$KEY_DIR/witness-public.pem" ]]; then
    echo "[fail] O diretório possui apenas parte do par de chaves; corrija-o manualmente." >&2
    exit 1
  fi
  bash "$KEYGEN_SOURCE" "$KEY_DIR"
else
  chmod 0700 "$KEY_DIR"
  chmod 0600 "$KEY_DIR/witness-private.pem"
  chmod 0644 "$KEY_DIR/witness-public.pem"
  echo "[ok] Par de chaves existente preservado."
fi

echo "[ok] Autorizador witness instalado."
echo "- comando: $INSTALL_PATH"
echo "- chave_publica: $KEY_DIR/witness-public.pem"
echo "- proximo_passo: copie somente a chave publica para os dois nos NodeAccess"
