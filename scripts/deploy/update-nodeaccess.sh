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
SESSION_AUDIT_BACKUP_SCRIPT="${SESSION_AUDIT_BACKUP_SCRIPT:-${PROJECT_ROOT}/scripts/backup/backup-session-audit.sh}"
USER_AVATAR_BACKUP_SCRIPT="${USER_AVATAR_BACKUP_SCRIPT:-${PROJECT_ROOT}/scripts/backup/backup-user-avatars.sh}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
GENERATE_SELF_SIGNED_SCRIPT="${GENERATE_SELF_SIGNED_SCRIPT:-${PROJECT_ROOT}/scripts/deploy/generate-self-signed-cert.sh}"
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"
RUN_BACKUP="${RUN_BACKUP:-true}"
RUN_STATEFUL_BACKUPS="${RUN_STATEFUL_BACKUPS:-true}"
REQUIRE_STATEFUL_BACKUPS="${REQUIRE_STATEFUL_BACKUPS:-false}"
RUN_PULL="${RUN_PULL:-true}"
RUN_SMOKE_CHECK="${RUN_SMOKE_CHECK:-true}"
SKIP_CERTS_CHECK="${SKIP_CERTS_CHECK:-false}"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-false}"
RECREATE_APP_SERVICES="${RECREATE_APP_SERVICES:-true}"
USE_EXTERNAL_STATEFUL_SERVICES="${USE_EXTERNAL_STATEFUL_SERVICES:-false}"
START_GUACD="${START_GUACD:-true}"
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
  source "$ENV_LOADER_SCRIPT"
  load_env_file "$ENV_FILE"
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
    "$ENV_LOADER_SCRIPT"
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

wait_for_mysql() {
  local attempt

  echo "[nodeaccess] Aguardando MySQL aceitar conexoes..."
  for attempt in {1..60}; do
    if run_compose exec -T mysql sh -lc 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done

  echo "MySQL nao ficou acessivel dentro do tempo esperado." >&2
  exit 1
}

configure_mysql_auth_plugin() {
  echo "[nodeaccess] Ajustando plugin de autenticacao do usuario MySQL..."
  run_compose exec -T mysql sh -lc '
    to_hex() {
      printf "%s" "$1" | od -An -tx1 | tr -d " \n"
    }

    db_user_hex="$(to_hex "$MYSQL_USER")"
    db_password_hex="$(to_hex "$MYSQL_PASSWORD")"

    mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
SET @db_user = CONVERT(0x${db_user_hex} USING utf8mb4);
SET @db_password = CONVERT(0x${db_password_hex} USING utf8mb4);
SET @sql = CONCAT("ALTER USER ", QUOTE(@db_user), CHAR(64), QUOTE("%"), " IDENTIFIED WITH mysql_native_password BY ", QUOTE(@db_password));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
FLUSH PRIVILEGES;
SQL
  '
}

run_migrations() {
  if [[ "$SKIP_MIGRATIONS" == "true" ]]; then
    echo "[nodeaccess] Migrations ignoradas por SKIP_MIGRATIONS=true."
    return
  fi

  echo "[nodeaccess] Aplicando migrations via container da API..."
  if [[ "$USE_EXTERNAL_STATEFUL_SERVICES" == "true" ]]; then
    run_compose run --rm --no-deps api npx prisma migrate deploy
  else
    run_compose run --rm api npx prisma migrate deploy
  fi
}

run_stateful_backup() {
  local label="$1"
  local script_path="$2"

  if [[ ! -f "$script_path" ]]; then
    echo "[nodeaccess] Backup de $label ignorado; script ausente: $script_path"
    return
  fi

  if ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" bash "$script_path" "$BACKUP_DIR"; then
    return
  fi

  if [[ "$REQUIRE_STATEFUL_BACKUPS" == "true" ]]; then
    echo "Backup de $label falhou e REQUIRE_STATEFUL_BACKUPS=true." >&2
    exit 1
  fi

  echo "[nodeaccess] Backup de $label falhou; continuando porque REQUIRE_STATEFUL_BACKUPS=false." >&2
}

main() {
  require_command docker
  validate_paths
  load_env
  resolve_tls_config
  validate_certs

  echo "[nodeaccess] Validando ambiente..."
  TLS_MODE="$TLS_MODE" bash "$VALIDATE_ENV_SCRIPT" "$ENV_FILE"

  echo "[nodeaccess] Validando compose..."
  run_compose config >/dev/null

  if [[ "$RUN_BACKUP" == "true" ]]; then
    echo "[nodeaccess] Gerando backup antes da atualizacao..."
    # Backup antes do upgrade reduz risco operacional de rollback logico.
    ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" bash "$BACKUP_SCRIPT" "$BACKUP_DIR"
    if [[ "$RUN_STATEFUL_BACKUPS" == "true" ]]; then
      run_stateful_backup "auditoria SSH" "$SESSION_AUDIT_BACKUP_SCRIPT"
      run_stateful_backup "avatares de usuario" "$USER_AVATAR_BACKUP_SCRIPT"
    fi
  fi

  if [[ "$RUN_PULL" == "true" ]]; then
    echo "[nodeaccess] Baixando imagens mais recentes referenciadas no compose..."
    run_compose pull
  fi

  if [[ "$USE_EXTERNAL_STATEFUL_SERVICES" == "true" ]]; then
    echo "[nodeaccess] MySQL e Redis externos; servicos locais nao serao iniciados."
    if [[ "$START_GUACD" == "true" ]]; then
      run_compose up -d guacd
    fi
  else
    echo "[nodeaccess] Garantindo infra base..."
    run_compose up -d mysql redis
    wait_for_mysql
    configure_mysql_auth_plugin
  fi
  run_migrations

  echo "[nodeaccess] Atualizando servicos..."
  if [[ "$RECREATE_APP_SERVICES" == "true" ]]; then
    echo "[nodeaccess] Recriando servicos da aplicacao para garantir uso das imagens recem-carregadas..."
    run_compose up -d --force-recreate --no-deps api ssh-gateway frontend
  else
    run_compose up -d
  fi

  if [[ "$RUN_SMOKE_CHECK" == "true" ]]; then
    echo "[nodeaccess] Executando smoke check..."
    ENV_FILE="$ENV_FILE" bash "$SMOKE_CHECK_SCRIPT"
  fi

  echo "[nodeaccess] Atualizacao concluida."
  echo "- compose_file: $COMPOSE_FILE"
  echo "- compose_project_name: $COMPOSE_PROJECT_NAME"
  echo "- env_file: $ENV_FILE"
  echo "- backup_dir: $BACKUP_DIR"
  echo "- run_stateful_backups: $RUN_STATEFUL_BACKUPS"
  echo "- require_stateful_backups: $REQUIRE_STATEFUL_BACKUPS"
  echo "- tls_mode: $TLS_MODE"
  echo "- nginx_config_file: $NGINX_CONFIG_FILE"
  echo "- recreate_app_services: $RECREATE_APP_SERVICES"
  echo "- use_external_stateful_services: $USE_EXTERNAL_STATEFUL_SERVICES"
}

main "$@"
