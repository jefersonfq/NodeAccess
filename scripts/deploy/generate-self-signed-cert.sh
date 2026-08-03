#!/usr/bin/env bash
set -euo pipefail

# Gera um certificado self-signed minimo para bootstrap de HTTPS.
# Serve para POC/lab/rede interna. Nao substitui um certificado valido
# para ambiente exposto publicamente.

ENV_FILE="${ENV_FILE:-.env}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"
CERTS_DIR="${CERTS_DIR:-./certs}"
SELF_SIGNED_CERT_DAYS="${SELF_SIGNED_CERT_DAYS:-365}"
SELF_SIGNED_CERT_HOST="${SELF_SIGNED_CERT_HOST:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Comando obrigatorio nao encontrado: $1" >&2
    exit 1
  fi
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_LOADER_SCRIPT"
    load_env_file "$ENV_FILE"
  fi
}

resolve_host() {
  # O host preferencial pode vir explicitamente por SELF_SIGNED_CERT_HOST.
  # Caso contrario, e derivado de APP_URL para reduzir configuracao manual.
  if [[ -n "$SELF_SIGNED_CERT_HOST" ]]; then
    echo "$SELF_SIGNED_CERT_HOST"
    return
  fi

  if [[ -z "${APP_URL:-}" ]]; then
    echo "APP_URL nao definido e SELF_SIGNED_CERT_HOST ausente." >&2
    exit 1
  fi

  local stripped="${APP_URL#http://}"
  stripped="${stripped#https://}"
  stripped="${stripped%%/*}"
  stripped="${stripped%%:*}"

  if [[ -z "$stripped" ]]; then
    echo "Nao foi possivel derivar host de APP_URL: ${APP_URL}" >&2
    exit 1
  fi

  echo "$stripped"
}

build_san_line() {
  # Gera SAN coerente com host DNS ou IP, evitando certificado sem extensao
  # basica de Subject Alternative Name.
  local host="$1"
  if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "IP.1 = ${host}"
    return
  fi
  echo "DNS.1 = ${host}"
}

main() {
  require_command openssl
  load_env

  local host
  host="$(resolve_host)"

  mkdir -p "$CERTS_DIR"

  local privkey_path="${CERTS_DIR}/privkey.pem"
  local fullchain_path="${CERTS_DIR}/fullchain.pem"
  local openssl_config
  openssl_config="$(mktemp)"

  cat > "$openssl_config" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
CN = ${host}

[v3_req]
subjectAltName = @alt_names

[alt_names]
$(build_san_line "$host")
EOF

  openssl req \
    -x509 \
    -nodes \
    -newkey rsa:2048 \
    -keyout "$privkey_path" \
    -out "$fullchain_path" \
    -days "$SELF_SIGNED_CERT_DAYS" \
    -config "$openssl_config"

  rm -f "$openssl_config"

  chmod 600 "$privkey_path"
  chmod 644 "$fullchain_path"

  echo "[nodeaccess] Certificado self-signed gerado."
  echo "- certs_dir: $CERTS_DIR"
  echo "- host: $host"
  echo "- days: $SELF_SIGNED_CERT_DAYS"
}

main "$@"
