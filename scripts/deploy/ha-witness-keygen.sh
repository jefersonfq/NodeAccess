#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-./nodeaccess-ha-witness-keys}"
PRIVATE_KEY="${OUTPUT_DIR}/witness-private.pem"
PUBLIC_KEY="${OUTPUT_DIR}/witness-public.pem"

command -v openssl >/dev/null 2>&1 || {
  echo "[fail] openssl nao encontrado." >&2
  exit 1
}

if [[ -e "$PRIVATE_KEY" || -e "$PUBLIC_KEY" ]]; then
  echo "[fail] Chaves ja existem em ${OUTPUT_DIR}; nenhuma chave foi sobrescrita." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
chmod 0700 "$OUTPUT_DIR"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$PRIVATE_KEY" >/dev/null 2>&1
openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY" >/dev/null 2>&1
chmod 0600 "$PRIVATE_KEY"
chmod 0644 "$PUBLIC_KEY"

echo "[ok] Par de chaves do witness criado."
echo "- private_key: $PRIVATE_KEY"
echo "- public_key: $PUBLIC_KEY"
echo "- mantenha a chave privada somente no host witness"
