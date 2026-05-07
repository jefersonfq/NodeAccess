#!/usr/bin/env bash
set -euo pipefail

# Instalacao da stack a partir de uma release ja extraida.
# Fluxo:
# 1. garante .env e scripts necessarios
# 2. resolve o modo de TLS e a config efetiva do Nginx
# 3. valida ambiente/compose
# 4. sobe infra base, aplica migrations e sobe a stack final

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"
ENV_EXAMPLE_FILE="${ENV_EXAMPLE_FILE:-${PROJECT_ROOT}/.env.example.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-${PROJECT_ROOT}/docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
CERTS_DIR="${CERTS_DIR:-${PROJECT_ROOT}/certs}"
VALIDATE_ENV_SCRIPT="${VALIDATE_ENV_SCRIPT:-${PROJECT_ROOT}/scripts/install/validate-env.sh}"
SMOKE_CHECK_SCRIPT="${SMOKE_CHECK_SCRIPT:-${PROJECT_ROOT}/scripts/install/smoke-check.sh}"
GENERATE_SELF_SIGNED_SCRIPT="${GENERATE_SELF_SIGNED_SCRIPT:-${PROJECT_ROOT}/scripts/deploy/generate-self-signed-cert.sh}"
RUN_SMOKE_CHECK="${RUN_SMOKE_CHECK:-true}"
SKIP_CERTS_CHECK="${SKIP_CERTS_CHECK:-false}"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-false}"
RECREATE_APP_SERVICES="${RECREATE_APP_SERVICES:-true}"
TLS_MODE="${TLS_MODE:-}"
NGINX_CONFIG_FILE="${NGINX_CONFIG_FILE:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Comando obrigatorio nao encontrado: $1" >&2
    exit 1
  fi
}

run_compose() {
  # O compose recebe TLS_MODE/NGINX_CONFIG_FILE por ambiente para
  # selecionar a configuracao correta sem manter multiplos compose files.
  TLS_MODE="$TLS_MODE" NGINX_CONFIG_FILE="$NGINX_CONFIG_FILE" \
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

load_env() {
  set -a
  source "$ENV_FILE"
  set +a
}

resolve_tls_config() {
  # off        -> HTTP puro, sem exigir cert
  # provided   -> HTTPS com certificado manual do host
  # selfsigned -> HTTPS com bootstrap local via openssl
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

ensure_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    return
  fi

  if [[ ! -f "$ENV_EXAMPLE_FILE" ]]; then
    echo "Arquivo de exemplo nao encontrado para criar .env: $ENV_EXAMPLE_FILE" >&2
    exit 1
  fi

  cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
  echo "[nodeaccess] .env criado a partir de $(basename "$ENV_EXAMPLE_FILE")."
  echo "[nodeaccess] Ajuste os valores reais antes de repetir a instalacao, se ainda houver placeholders."
}

validate_paths() {
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "Compose nao encontrado: $COMPOSE_FILE" >&2
    exit 1
  fi

  if [[ ! -f "$VALIDATE_ENV_SCRIPT" ]]; then
    echo "Script de validacao nao encontrado: $VALIDATE_ENV_SCRIPT" >&2
    exit 1
  fi

  if [[ ! -f "$SMOKE_CHECK_SCRIPT" ]]; then
    echo "Script de smoke check nao encontrado: $SMOKE_CHECK_SCRIPT" >&2
    exit 1
  fi

  if [[ ! -f "$GENERATE_SELF_SIGNED_SCRIPT" ]]; then
    echo "Script de self-signed nao encontrado: $GENERATE_SELF_SIGNED_SCRIPT" >&2
    exit 1
  fi
}

validate_certs() {
  if [[ "$SKIP_CERTS_CHECK" == "true" ]]; then
    return
  fi

  if [[ "$TLS_MODE" == "off" ]]; then
    return
  fi

  if [[ "$TLS_MODE" == "selfsigned" ]]; then
    # Gera o material apenas se ainda nao existir, para nao sobrescrever
    # certificado local previamente aceito no ambiente.
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
  # Mantem a imagem de runtime como fonte da migration efetiva, evitando
  # depender de node/npm instalados no host de destino.
  run_compose run --rm api npx prisma migrate deploy
}

main() {
  require_command docker
  validate_paths
  ensure_env_file
  load_env
  resolve_tls_config
  validate_certs

  echo "[nodeaccess] Validando ambiente..."
  bash "$VALIDATE_ENV_SCRIPT" "$ENV_FILE"

  echo "[nodeaccess] Validando compose..."
  run_compose config >/dev/null

  echo "[nodeaccess] Subindo MySQL e Redis..."
  run_compose up -d mysql redis

  wait_for_mysql
  configure_mysql_auth_plugin
  run_migrations

  echo "[nodeaccess] Subindo API, gateway e frontend..."
  if [[ "$RECREATE_APP_SERVICES" == "true" ]]; then
    echo "[nodeaccess] Recriando servicos da aplicacao para garantir uso das imagens recem-carregadas..."
    run_compose up -d --force-recreate --no-deps api ssh-gateway frontend
  else
    run_compose up -d api ssh-gateway frontend
  fi

  if [[ "$RUN_SMOKE_CHECK" == "true" ]]; then
    echo "[nodeaccess] Executando smoke check..."
    ENV_FILE="$ENV_FILE" bash "$SMOKE_CHECK_SCRIPT"
  fi

  echo "[nodeaccess] Instalacao concluida."
  echo "- compose_file: $COMPOSE_FILE"
  echo "- compose_project_name: $COMPOSE_PROJECT_NAME"
  echo "- env_file: $ENV_FILE"
  echo "- certs_dir: $CERTS_DIR"
  echo "- tls_mode: $TLS_MODE"
  echo "- nginx_config_file: $NGINX_CONFIG_FILE"
  echo "- recreate_app_services: $RECREATE_APP_SERVICES"
}

main "$@"
