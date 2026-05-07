#!/usr/bin/env bash
set -euo pipefail

# Diagnostico nao-destrutivo do host de deploy.
# Nao altera a stack. Apenas valida arquivos, compose, imagens,
# certs/TLS e, opcionalmente, health endpoints.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${PROJECT_ROOT}/docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
CERTS_DIR="${CERTS_DIR:-${PROJECT_ROOT}/certs}"
VALIDATE_ENV_SCRIPT="${VALIDATE_ENV_SCRIPT:-${PROJECT_ROOT}/scripts/install/validate-env.sh}"
SMOKE_CHECK_SCRIPT="${SMOKE_CHECK_SCRIPT:-${PROJECT_ROOT}/scripts/install/smoke-check.sh}"
RUN_SMOKE_CHECK="${RUN_SMOKE_CHECK:-false}"
TLS_MODE="${TLS_MODE:-}"
NGINX_CONFIG_FILE="${NGINX_CONFIG_FILE:-}"

WARNINGS=0

log_ok() {
  echo "[ok] $1"
}

log_warn() {
  echo "[warn] $1"
  WARNINGS=$((WARNINGS + 1))
}

log_fail() {
  echo "[fail] $1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || log_fail "Comando obrigatorio nao encontrado: $1"
}

run_compose() {
  TLS_MODE="$TLS_MODE" NGINX_CONFIG_FILE="$NGINX_CONFIG_FILE" \
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

load_env() {
  set -a
  source "$ENV_FILE"
  set +a
}

resolve_tls_config() {
  TLS_MODE="${TLS_MODE:-${TLS_MODE:-provided}}"
  case "$TLS_MODE" in
    off)
      NGINX_CONFIG_FILE="${NGINX_CONFIG_FILE:-./docker/nginx.http.conf}"
      ;;
    provided|selfsigned)
      NGINX_CONFIG_FILE="${NGINX_CONFIG_FILE:-./docker/nginx.https.conf}"
      ;;
    *)
      log_fail "TLS_MODE invalido: $TLS_MODE"
      ;;
  esac
}

check_file() {
  local file_path="$1"
  [[ -f "$file_path" ]] || log_fail "Arquivo obrigatorio nao encontrado: $file_path"
}

check_certs() {
  if [[ "$TLS_MODE" == "off" ]]; then
    # HTTP puro pode ser valido em laboratorio ou atras de proxy externo,
    # mas merece alerta explicito no doctor.
    log_warn "TLS desabilitado (TLS_MODE=off). Use apenas em rede interna controlada ou com reverse proxy externo."
    return
  fi

  if [[ ! -d "$CERTS_DIR" ]]; then
    log_warn "Diretorio de certificados ausente: $CERTS_DIR"
    return
  fi

  if [[ -f "${CERTS_DIR}/fullchain.pem" && -f "${CERTS_DIR}/privkey.pem" ]]; then
    if [[ "$TLS_MODE" == "selfsigned" ]]; then
      log_warn "Certificado presente em modo selfsigned. Aceitavel para bootstrap, nao ideal para internet publica."
    else
      log_ok "Certificados encontrados em $CERTS_DIR"
    fi
  else
    log_warn "Certificados incompletos em $CERTS_DIR. Esperado: fullchain.pem e privkey.pem"
  fi
}

check_compose_services() {
  local service_count
  service_count="$(run_compose config --services | wc -l | tr -d '[:space:]')"
  log_ok "Compose valido com ${service_count} servico(s)"
}

check_compose_ps() {
  if run_compose ps >/tmp/nodeaccess-doctor-ps.$$ 2>/tmp/nodeaccess-doctor-ps.err.$$; then
    if [[ -s /tmp/nodeaccess-doctor-ps.$$ ]]; then
      log_ok "docker compose ps executado com sucesso"
      cat /tmp/nodeaccess-doctor-ps.$$
    else
      log_warn "docker compose ps nao retornou containers visiveis"
    fi
  else
    log_warn "Nao foi possivel consultar docker compose ps"
    cat /tmp/nodeaccess-doctor-ps.err.$$ >&2 || true
  fi
  rm -f /tmp/nodeaccess-doctor-ps.$$ /tmp/nodeaccess-doctor-ps.err.$$
}

check_images() {
  # Ajuda a distinguir problema de compose/config de problema de artefato
  # ausente no host (registry/pull/bundle offline).
  while IFS= read -r image_name; do
    [[ -n "$image_name" ]] || continue
    if docker image inspect "$image_name" >/dev/null 2>&1; then
      log_ok "Imagem disponivel localmente: $image_name"
    else
      log_warn "Imagem nao encontrada localmente: $image_name"
    fi
  done < <(run_compose config --images)
}

main() {
  require_command docker
  require_command bash
  require_command curl

  check_file "$ENV_FILE"
  check_file "$COMPOSE_FILE"
  check_file "$VALIDATE_ENV_SCRIPT"
  check_file "$SMOKE_CHECK_SCRIPT"
  load_env
  resolve_tls_config

  echo "[nodeaccess] Validando .env..."
  bash "$VALIDATE_ENV_SCRIPT" "$ENV_FILE" >/dev/null
  log_ok "Ambiente valido"

  echo "[nodeaccess] Validando docker compose..."
  run_compose config >/dev/null
  check_compose_services
  check_certs
  check_images
  check_compose_ps

  if [[ "$RUN_SMOKE_CHECK" == "true" ]]; then
    echo "[nodeaccess] Executando smoke check..."
    ENV_FILE="$ENV_FILE" bash "$SMOKE_CHECK_SCRIPT"
    log_ok "Smoke check concluido"
  else
    log_warn "Smoke check nao executado. Use RUN_SMOKE_CHECK=true para validar health."
  fi

  if [[ "$WARNINGS" -eq 0 ]]; then
    echo "[nodeaccess] Doctor concluido sem alertas."
  else
    echo "[nodeaccess] Doctor concluido com ${WARNINGS} alerta(s)."
  fi
  echo "- compose_project_name: $COMPOSE_PROJECT_NAME"
  echo "- tls_mode: $TLS_MODE"
  echo "- nginx_config_file: $NGINX_CONFIG_FILE"
}

main "$@"
