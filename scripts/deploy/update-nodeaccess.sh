#!/usr/bin/env bash
set -euo pipefail

# Atualizacao da stack a partir da release atual.
# Fluxo:
# 1. valida ambiente e TLS
# 2. faz backup opcional
# 3. garante imagens / infra base
# 4. reaplica migrations e sobe a nova composicao

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${PROJECT_ROOT}/docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
CERTS_DIR="${CERTS_DIR:-${PROJECT_ROOT}/certs}"
VALIDATE_ENV_SCRIPT="${VALIDATE_ENV_SCRIPT:-${PROJECT_ROOT}/scripts/install/validate-env.sh}"
SMOKE_CHECK_SCRIPT="${SMOKE_CHECK_SCRIPT:-${PROJECT_ROOT}/scripts/install/smoke-check.sh}"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-${PROJECT_ROOT}/scripts/backup/backup-mysql.sh}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
GENERATE_SELF_SIGNED_SCRIPT="${GENERATE_SELF_SIGNED_SCRIPT:-${PROJECT_ROOT}/scripts/deploy/generate-self-signed-cert.sh}"
RUN_BACKUP="${RUN_BACKUP:-true}"
RUN_PULL="${RUN_PULL:-true}"
RUN_SMOKE_CHECK="${RUN_SMOKE_CHECK:-true}"
SKIP_CERTS_CHECK="${SKIP_CERTS_CHECK:-false}"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-false}"
TLS_MODE="${TLS_MODE:-}"
NGINX_CONFIG_FILE="${NGINX_CONFIG_FILE:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Comando obrigatorio nao encontrado: $1" >&2
    exit 1
  fi
}

run_compose() {
  # Reaproveita a mesma selecao de TLS da instalacao para que update e install
  # subam exatamente a mesma topologia.
  TLS_MODE="$TLS_MODE" NGINX_CONFIG_FILE="$NGINX_CONFIG_FILE" \
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

load_env() {
  set -a
  source "$ENV_FILE"
  set +a
}

resolve_tls_config() {
  # Mantem o mesmo contrato de TLS_MODE usado no install.
  TLS_MODE="${TLS_MODE:-${TLS_MODE:-provided}}"
  case "$TLS_MODE" in
    off)
      NGINX_CONFIG_FILE="${NGINX_CONFIG_FILE:-./docker/nginx.http.conf}"
      ;;
    provided|selfsigned)
      NGINX_CONFIG_FILE="${NGINX_CONFIG_FILE:-./docker/nginx.https.conf}"
      ;;
    *)
      echo "TLS_MODE invalido: $TLS_MODE" >&2
      exit 1
      ;;
  esac
}

validate_paths() {
  local required_files=(
    "$ENV_FILE"
    "$COMPOSE_FILE"
    "$VALIDATE_ENV_SCRIPT"
    "$SMOKE_CHECK_SCRIPT"
    "$BACKUP_SCRIPT"
    "$GENERATE_SELF_SIGNED_SCRIPT"
  )

  for file_path in "${required_files[@]}"; do
    if [[ ! -f "$file_path" ]]; then
      echo "Arquivo obrigatorio nao encontrado: $file_path" >&2
      exit 1
    fi
  done
}

validate_certs() {
  if [[ "$SKIP_CERTS_CHECK" == "true" ]]; then
    return
  fi

  if [[ "$TLS_MODE" == "off" ]]; then
    return
  fi

  if [[ "$TLS_MODE" == "selfsigned" ]]; then
    if [[ ! -f "${CERTS_DIR}/fullchain.pem" || ! -f "${CERTS_DIR}/privkey.pem" ]]; then
      echo "[nodeaccess] Gerando certificado self-signed em $CERTS_DIR..."
      ENV_FILE="$ENV_FILE" CERTS_DIR="$CERTS_DIR" bash "$GENERATE_SELF_SIGNED_SCRIPT"
    fi
    return
  fi

  if [[ ! -d "$CERTS_DIR" ]]; then
    echo "Diretorio de certificados nao encontrado: $CERTS_DIR" >&2
    exit 1
  fi

  if [[ ! -f "${CERTS_DIR}/fullchain.pem" || ! -f "${CERTS_DIR}/privkey.pem" ]]; then
    echo "Certificados ausentes em $CERTS_DIR. Esperado: fullchain.pem e privkey.pem" >&2
    exit 1
  fi
}

run_migrations() {
  if [[ "$SKIP_MIGRATIONS" == "true" ]]; then
    echo "[nodeaccess] Migrations ignoradas por SKIP_MIGRATIONS=true."
    return
  fi

  echo "[nodeaccess] Aplicando migrations via container da API..."
  run_compose run --rm api npx prisma migrate deploy
}

main() {
  require_command docker
  validate_paths
  load_env
  resolve_tls_config
  validate_certs

  echo "[nodeaccess] Validando ambiente..."
  bash "$VALIDATE_ENV_SCRIPT" "$ENV_FILE"

  echo "[nodeaccess] Validando compose..."
  run_compose config >/dev/null

  if [[ "$RUN_BACKUP" == "true" ]]; then
    echo "[nodeaccess] Gerando backup antes da atualizacao..."
    # Backup antes do upgrade reduz risco operacional de rollback logico.
    ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" bash "$BACKUP_SCRIPT" "$BACKUP_DIR"
  fi

  if [[ "$RUN_PULL" == "true" ]]; then
    echo "[nodeaccess] Baixando imagens mais recentes referenciadas no compose..."
    run_compose pull
  fi

  echo "[nodeaccess] Garantindo infra base..."
  run_compose up -d mysql redis

  run_migrations

  echo "[nodeaccess] Atualizando servicos..."
  run_compose up -d

  if [[ "$RUN_SMOKE_CHECK" == "true" ]]; then
    echo "[nodeaccess] Executando smoke check..."
    ENV_FILE="$ENV_FILE" bash "$SMOKE_CHECK_SCRIPT"
  fi

  echo "[nodeaccess] Atualizacao concluida."
  echo "- compose_file: $COMPOSE_FILE"
  echo "- compose_project_name: $COMPOSE_PROJECT_NAME"
  echo "- env_file: $ENV_FILE"
  echo "- backup_dir: $BACKUP_DIR"
  echo "- tls_mode: $TLS_MODE"
  echo "- nginx_config_file: $NGINX_CONFIG_FILE"
}

main "$@"
