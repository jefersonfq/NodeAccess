#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${1:-.env}"
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de ambiente nao encontrado: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_LOADER_SCRIPT" ]]; then
  echo "Carregador de ambiente nao encontrado: $ENV_LOADER_SCRIPT" >&2
  exit 1
fi

source "$ENV_LOADER_SCRIPT"
load_env_file "$ENV_FILE"

USE_EXTERNAL_STATEFUL_SERVICES="${USE_EXTERNAL_STATEFUL_SERVICES:-false}"
NODEACCESS_BIND_ADDRESS="${NODEACCESS_BIND_ADDRESS:-0.0.0.0}"
NODEACCESS_HTTP_PORT="${NODEACCESS_HTTP_PORT:-80}"
NODEACCESS_HTTPS_PORT="${NODEACCESS_HTTPS_PORT:-443}"
NODEACCESS_BEHIND_REVERSE_PROXY="${NODEACCESS_BEHIND_REVERSE_PROXY:-false}"

required_vars=(
  NODE_ENV
  APP_URL
  TLS_MODE
  DATABASE_URL
  REDIS_URL
  JWT_SECRET
  PEM_ENCRYPTION_KEY
  DB_NAME
  DB_USER
  DB_PASSWORD
)

if [[ "$USE_EXTERNAL_STATEFUL_SERVICES" != "true" ]]; then
  required_vars+=(DB_ROOT_PASSWORD)
fi

missing=0
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Falta variavel obrigatoria: $var_name" >&2
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

if [[ "$NODE_ENV" != "production" && "$NODE_ENV" != "development" && "$NODE_ENV" != "test" ]]; then
  echo "NODE_ENV invalido: $NODE_ENV" >&2
  exit 1
fi

if [[ "$TLS_MODE" != "off" && "$TLS_MODE" != "provided" && "$TLS_MODE" != "selfsigned" ]]; then
  echo "TLS_MODE invalido: esperado off, provided ou selfsigned" >&2
  exit 1
fi

if [[ "$NODEACCESS_BEHIND_REVERSE_PROXY" != "true" && "$NODEACCESS_BEHIND_REVERSE_PROXY" != "false" ]]; then
  echo "NODEACCESS_BEHIND_REVERSE_PROXY invalido: esperado true ou false" >&2
  exit 1
fi

if [[ ! "$NODEACCESS_BIND_ADDRESS" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "NODEACCESS_BIND_ADDRESS invalido: use um endereco IPv4, como 0.0.0.0 ou 127.0.0.1" >&2
  exit 1
fi
IFS='.' read -r -a bind_octets <<<"$NODEACCESS_BIND_ADDRESS"
for bind_octet in "${bind_octets[@]}"; do
  if (( 10#$bind_octet > 255 )); then
    echo "NODEACCESS_BIND_ADDRESS invalido: octeto fora do intervalo 0-255" >&2
    exit 1
  fi
done

for port_var in NODEACCESS_HTTP_PORT NODEACCESS_HTTPS_PORT; do
  port_value="${!port_var}"
  if [[ ! "$port_value" =~ ^[0-9]+$ ]] || (( port_value < 1 || port_value > 65535 )); then
    echo "$port_var invalida: esperado numero entre 1 e 65535" >&2
    exit 1
  fi
done

if [[ "$NODEACCESS_HTTP_PORT" == "$NODEACCESS_HTTPS_PORT" ]]; then
  echo "Portas do frontend invalidas: NODEACCESS_HTTP_PORT e NODEACCESS_HTTPS_PORT devem ser diferentes" >&2
  exit 1
fi

for frontend_port in "$NODEACCESS_HTTP_PORT" "$NODEACCESS_HTTPS_PORT"; do
  if [[ "$frontend_port" == "3000" || "$frontend_port" == "3001" ]]; then
    echo "Porta do frontend invalida: $frontend_port e reservada pela API/gateway publicados pelo Compose" >&2
    exit 1
  fi
done

if [[ "$NODEACCESS_BEHIND_REVERSE_PROXY" == "true" ]]; then
  if [[ "$TLS_MODE" != "off" ]]; then
    echo "Proxy externo inconsistente: use TLS_MODE=off; o TLS deve terminar no proxy externo" >&2
    exit 1
  fi
  if [[ "${TRUST_PROXY:-false}" != "true" ]]; then
    echo "Proxy externo inconsistente: use TRUST_PROXY=true" >&2
    exit 1
  fi
  if [[ "$NODEACCESS_BIND_ADDRESS" != "127.0.0.1" ]]; then
    echo "Proxy externo inseguro: use NODEACCESS_BIND_ADDRESS=127.0.0.1" >&2
    exit 1
  fi
fi

if [[ ! "$APP_URL" =~ ^https?:// ]]; then
  echo "APP_URL invalido: deve iniciar com http:// ou https://" >&2
  exit 1
fi

if [[ "$TLS_MODE" == "off" && "$NODEACCESS_BEHIND_REVERSE_PROXY" != "true" && "$APP_URL" =~ ^https:// ]]; then
  echo "APP_URL inconsistente: use http:// quando TLS_MODE=off" >&2
  exit 1
fi

if [[ "$TLS_MODE" != "off" && "$APP_URL" =~ ^http:// ]]; then
  echo "APP_URL inconsistente: use https:// quando TLS_MODE=$TLS_MODE" >&2
  exit 1
fi

if [[ -n "${APP_FRONTEND_URL:-}" && ! "$APP_FRONTEND_URL" =~ ^https?:// ]]; then
  echo "APP_FRONTEND_URL invalido: deve iniciar com http:// ou https://" >&2
  exit 1
fi

if [[ -n "${APP_FRONTEND_URL:-}" ]]; then
  if [[ "$TLS_MODE" == "off" && "$NODEACCESS_BEHIND_REVERSE_PROXY" != "true" && "$APP_FRONTEND_URL" =~ ^https:// ]]; then
    echo "APP_FRONTEND_URL inconsistente: use http:// quando TLS_MODE=off" >&2
    exit 1
  fi

  if [[ "$TLS_MODE" != "off" && "$APP_FRONTEND_URL" =~ ^http:// ]]; then
    echo "APP_FRONTEND_URL inconsistente: use https:// quando TLS_MODE=$TLS_MODE" >&2
    exit 1
  fi
fi

if [[ ! "$DATABASE_URL" =~ ^mysql:// ]]; then
  echo "DATABASE_URL invalido: esperado prefixo mysql://" >&2
  exit 1
fi

url_encode_component() {
  local input="$1"
  local hex byte encoded=""

  hex="$(printf "%s" "$input" | od -An -tx1 | tr -d ' \n')"
  while [[ -n "$hex" ]]; do
    byte="${hex:0:2}"
    hex="${hex:2}"

    case "$byte" in
      2d|2e|5f|7e|[3][0-9]|[4][1-9a-f]|[5][0-9a]|[6][1-9a-f]|[7][0-9a])
        encoded+="$(printf '%b' "\\x${byte}")"
        ;;
      *)
        encoded+="%${byte^^}"
        ;;
    esac
  done

  printf "%s" "$encoded"
}

validate_database_url_consistency() {
  local db_url_user db_url_password db_url_host db_url_port db_url_name
  local encoded_db_user encoded_db_password encoded_db_name

  if [[ ! "$DATABASE_URL" =~ ^mysql://([^:/@?]+):([^@]*)@([^:/?]+):([0-9]+)/([^?]+)(\?.*)?$ ]]; then
    echo "DATABASE_URL invalido: esperado formato mysql://user:password@host:3306/database" >&2
    exit 1
  fi

  db_url_user="${BASH_REMATCH[1]}"
  db_url_password="${BASH_REMATCH[2]}"
  db_url_host="${BASH_REMATCH[3]}"
  db_url_port="${BASH_REMATCH[4]}"
  db_url_name="${BASH_REMATCH[5]}"

  encoded_db_user="$(url_encode_component "$DB_USER")"
  encoded_db_password="$(url_encode_component "$DB_PASSWORD")"
  encoded_db_name="$(url_encode_component "$DB_NAME")"

  if [[ "$db_url_user" != "$DB_USER" && "$db_url_user" != "$encoded_db_user" ]]; then
    echo "DATABASE_URL inconsistente: usuario da URL nao bate com DB_USER" >&2
    exit 1
  fi

  if [[ "$db_url_password" != "$DB_PASSWORD" && "$db_url_password" != "$encoded_db_password" ]]; then
    echo "DATABASE_URL inconsistente: senha da URL nao bate com DB_PASSWORD" >&2
    exit 1
  fi

  if [[ "$db_url_name" != "$DB_NAME" && "$db_url_name" != "$encoded_db_name" ]]; then
    echo "DATABASE_URL inconsistente: database da URL nao bate com DB_NAME" >&2
    exit 1
  fi

  if [[ "$USE_EXTERNAL_STATEFUL_SERVICES" == "true" ]]; then
    if [[ -n "${DB_HOST:-}" && "$db_url_host" != "$DB_HOST" ]]; then
      echo "DATABASE_URL inconsistente: host da URL nao bate com DB_HOST" >&2
      exit 1
    fi
    if [[ -n "${DB_PORT:-}" && "$db_url_port" != "$DB_PORT" ]]; then
      echo "DATABASE_URL inconsistente: porta da URL nao bate com DB_PORT" >&2
      exit 1
    fi
  else
    if [[ "$db_url_port" != "3306" ]]; then
      echo "DATABASE_URL invalido: porta esperada para MySQL interno e 3306" >&2
      exit 1
    fi

    if [[ "$NODE_ENV" == "production" && "$db_url_host" != "mysql" ]]; then
      echo "DATABASE_URL inconsistente: em production o host esperado no Docker Compose e mysql" >&2
      exit 1
    fi
  fi
}

validate_database_url_consistency

if [[ ! "$REDIS_URL" =~ ^redis:// ]]; then
  echo "REDIS_URL invalido: esperado prefixo redis://" >&2
  exit 1
fi

if [[ "${#JWT_SECRET}" -lt 32 ]]; then
  echo "JWT_SECRET invalido: minimo de 32 caracteres" >&2
  exit 1
fi

if [[ ! "$PEM_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "PEM_ENCRYPTION_KEY invalida: esperado hex de 64 caracteres" >&2
  exit 1
fi

cat <<EOF
Validacao de ambiente concluida com sucesso:
- arquivo: $ENV_FILE
- node_env: $NODE_ENV
- tls_mode: $TLS_MODE
- app_url: $APP_URL
- app_frontend_url: ${APP_FRONTEND_URL:-<usa APP_URL>}
- frontend_bind: $NODEACCESS_BIND_ADDRESS
- frontend_http_port: $NODEACCESS_HTTP_PORT
- frontend_https_port: $NODEACCESS_HTTPS_PORT
- behind_reverse_proxy: $NODEACCESS_BEHIND_REVERSE_PROXY
- database_url: ok
- redis_url: ok
- external_stateful_services: $USE_EXTERNAL_STATEFUL_SERVICES
- jwt_secret: ok
- pem_encryption_key: ok

Lembrete critico:
- preserve a mesma PEM_ENCRYPTION_KEY ao restaurar um banco existente
EOF
