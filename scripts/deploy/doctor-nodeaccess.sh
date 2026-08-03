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
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"
RUN_SMOKE_CHECK="${RUN_SMOKE_CHECK:-false}"
RUN_DEEP_HEALTH_CHECK="${RUN_DEEP_HEALTH_CHECK:-false}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-30}"
MIN_DISK_FREE_MB="${MIN_DISK_FREE_MB:-10240}"
APP_URL_OVERRIDE="${APP_URL_OVERRIDE:-}"
API_DEEP_HEALTH_PATH="${API_DEEP_HEALTH_PATH:-/health/deep}"
API_DEEP_HEALTH_URL="${API_DEEP_HEALTH_URL:-}"
GATEWAY_DEEP_HEALTH_URL="${GATEWAY_DEEP_HEALTH_URL:-http://127.0.0.1:3001/health/deep}"
DOCTOR_HEALTH_INSECURE="${DOCTOR_HEALTH_INSECURE:-}"
TLS_MODE="${TLS_MODE:-}"
NGINX_CONFIG_FILE="${NGINX_CONFIG_FILE:-}"
DOCTOR_OUTPUT="${DOCTOR_OUTPUT:-text}"

WARNINGS=0
CHECK_LEVELS=()
CHECK_MESSAGES=()

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

record_check() {
  CHECK_LEVELS+=("$1")
  CHECK_MESSAGES+=("$2")
}

emit_info() {
  if [[ "$DOCTOR_OUTPUT" == "text" ]]; then
    echo "$1"
  fi
}

log_ok() {
  record_check "ok" "$1"
  if [[ "$DOCTOR_OUTPUT" == "text" ]]; then
    echo "[ok] $1"
  fi
}

log_warn() {
  record_check "warn" "$1"
  WARNINGS=$((WARNINGS + 1))
  if [[ "$DOCTOR_OUTPUT" == "text" ]]; then
    echo "[warn] $1"
  fi
}

log_fail() {
  record_check "fail" "$1"
  if [[ "$DOCTOR_OUTPUT" == "json" ]]; then
    print_summary "down" >&2
  else
    echo "[fail] $1" >&2
  fi
  exit 1
}

print_summary() {
  local status="${1:-}"
  if [[ -z "$status" ]]; then
    if [[ "$WARNINGS" -eq 0 ]]; then
      status="ok"
    else
      status="degraded"
    fi
  fi

  if [[ "$DOCTOR_OUTPUT" == "json" ]]; then
    printf '{'
    printf '"status":"%s",' "$status"
    printf '"warnings":%s,' "$WARNINGS"
    printf '"timestamp":"%s",' "$(date -Iseconds)"
    printf '"config":{'
    printf '"composeProjectName":"%s",' "$(json_escape "$COMPOSE_PROJECT_NAME")"
    printf '"tlsMode":"%s",' "$(json_escape "$TLS_MODE")"
    printf '"nginxConfigFile":"%s",' "$(json_escape "$NGINX_CONFIG_FILE")"
    printf '"runSmokeCheck":%s,' "$(if [[ "$RUN_SMOKE_CHECK" == "true" ]]; then echo true; else echo false; fi)"
    printf '"runDeepHealthCheck":%s,' "$(if [[ "$RUN_DEEP_HEALTH_CHECK" == "true" ]]; then echo true; else echo false; fi)"
    printf '"backupDir":"%s",' "$(json_escape "$BACKUP_DIR")"
    printf '"maxBackupAgeHours":%s,' "$MAX_BACKUP_AGE_HOURS"
    printf '"minDiskFreeMb":%s' "$MIN_DISK_FREE_MB"
    printf '},'
    printf '"checks":['
    local index
    for index in "${!CHECK_LEVELS[@]}"; do
      if [[ "$index" -gt 0 ]]; then
        printf ','
      fi
      printf '{"level":"%s","message":"%s"}' "$(json_escape "${CHECK_LEVELS[$index]}")" "$(json_escape "${CHECK_MESSAGES[$index]}")"
    done
    printf ']}'
    printf '\n'
    return
  fi

  if [[ "$WARNINGS" -eq 0 ]]; then
    echo "[nodeaccess] Doctor concluido sem alertas."
  else
    echo "[nodeaccess] Doctor concluido com ${WARNINGS} alerta(s)."
  fi
  echo "- compose_project_name: $COMPOSE_PROJECT_NAME"
  echo "- tls_mode: $TLS_MODE"
  echo "- nginx_config_file: $NGINX_CONFIG_FILE"
  echo "- run_smoke_check: $RUN_SMOKE_CHECK"
  echo "- run_deep_health_check: $RUN_DEEP_HEALTH_CHECK"
  echo "- backup_dir: $BACKUP_DIR"
  echo "- max_backup_age_hours: $MAX_BACKUP_AGE_HOURS"
  echo "- min_disk_free_mb: $MIN_DISK_FREE_MB"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || log_fail "Comando obrigatorio nao encontrado: $1"
}

run_compose() {
  TLS_MODE="$TLS_MODE" NGINX_CONFIG_FILE="$NGINX_CONFIG_FILE" \
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

load_env() {
  source "$ENV_LOADER_SCRIPT"
  load_env_file "$ENV_FILE"
}

resolve_tls_config() {
  case "$DOCTOR_OUTPUT" in
    text|json)
      ;;
    *)
      log_fail "DOCTOR_OUTPUT invalido: $DOCTOR_OUTPUT"
      ;;
  esac

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
      if [[ "$DOCTOR_OUTPUT" == "text" ]]; then
        cat /tmp/nodeaccess-doctor-ps.$$
      fi
    else
      log_warn "docker compose ps nao retornou containers visiveis"
    fi
  else
    log_warn "Nao foi possivel consultar docker compose ps"
    if [[ "$DOCTOR_OUTPUT" == "text" ]]; then
      cat /tmp/nodeaccess-doctor-ps.err.$$ >&2 || true
    fi
  fi
  rm -f /tmp/nodeaccess-doctor-ps.$$ /tmp/nodeaccess-doctor-ps.err.$$
}

check_images() {
  # Ajuda a distinguir problema de compose/config de problema de artefato
  # ausente no host (registry/pull/bundle offline).
  while IFS= read -r image_name; do
    [[ -n "$image_name" ]] || continue
    local inspect_error="/tmp/nodeaccess-doctor-image-${image_name//[^a-zA-Z0-9]/-}.$$"
    if docker image inspect "$image_name" >/dev/null 2>"$inspect_error"; then
      log_ok "Imagem disponivel localmente: $image_name"
    elif grep -qi 'permission denied\|cannot connect\|is the docker daemon running' "$inspect_error"; then
      log_warn "Nao foi possivel inspecionar imagem localmente: $image_name"
    else
      log_warn "Imagem nao encontrada localmente: $image_name"
    fi
    rm -f "$inspect_error"
  done < <(run_compose config --images | sort -u)
}

check_disk_path() {
  local label="$1"
  local path="$2"

  if [[ ! -e "$path" ]]; then
    log_warn "${label}: caminho ausente para checagem de disco: $path"
    return
  fi

  local available_kb
  available_kb="$(df -Pk "$path" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -z "$available_kb" ]]; then
    log_warn "${label}: nao foi possivel consultar espaco livre em $path"
    return
  fi

  local available_mb
  available_mb=$((available_kb / 1024))
  if (( available_mb < MIN_DISK_FREE_MB )); then
    log_warn "${label}: espaco livre baixo (${available_mb} MB; minimo ${MIN_DISK_FREE_MB} MB)"
  else
    log_ok "${label}: espaco livre suficiente (${available_mb} MB)"
  fi
}

check_compose_volume_disk() {
  local volume_name="$1"
  local docker_volume_name="${COMPOSE_PROJECT_NAME}_${volume_name}"
  local inspect_error="/tmp/nodeaccess-doctor-volume-${docker_volume_name//[^a-zA-Z0-9]/-}.$$"
  local mountpoint

  mountpoint="$(docker volume inspect "$docker_volume_name" --format '{{ .Mountpoint }}' 2>"$inspect_error" || true)"
  if [[ -z "$mountpoint" ]]; then
    if grep -qi 'permission denied\|cannot connect\|is the docker daemon running' "$inspect_error"; then
      log_warn "Nao foi possivel inspecionar volume Docker: $docker_volume_name"
    else
      log_warn "Volume Docker nao encontrado para checagem de disco: $docker_volume_name"
    fi
    rm -f "$inspect_error"
    return
  fi

  rm -f "$inspect_error"
  check_disk_path "volume ${docker_volume_name}" "$mountpoint"
}

check_disk_space() {
  require_command df

  check_disk_path "projeto" "$PROJECT_ROOT"

  if [[ -d "$BACKUP_DIR" ]]; then
    check_disk_path "backups" "$BACKUP_DIR"
  else
    log_warn "Diretorio de backups ausente: $BACKUP_DIR"
  fi

  while IFS= read -r volume_name; do
    [[ -n "$volume_name" ]] || continue
    check_compose_volume_disk "$volume_name"
  done < <(run_compose config --volumes)
}

check_recent_backup() {
  require_command find

  if [[ ! -d "$BACKUP_DIR" ]]; then
    log_warn "Backup recente nao validado; diretorio ausente: $BACKUP_DIR"
    return
  fi

  local latest_backup
  latest_backup="$(find "$BACKUP_DIR" -type f \( -name 'nodeaccess-mysql-*.manifest.json' -o -name 'nodeaccess-mysql-*.sql.gz' \) -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 || true)"
  if [[ -z "$latest_backup" ]]; then
    log_warn "Nenhum backup MySQL encontrado em $BACKUP_DIR"
    return
  fi

  local mtime_raw="${latest_backup%% *}"
  local backup_path="${latest_backup#* }"
  local mtime="${mtime_raw%.*}"
  local now
  now="$(date +%s)"

  local age_hours
  age_hours=$(((now - mtime) / 3600))

  if (( age_hours > MAX_BACKUP_AGE_HOURS )); then
    log_warn "Backup mais recente antigo (${age_hours}h; limite ${MAX_BACKUP_AGE_HOURS}h): $backup_path"
  else
    log_ok "Backup recente encontrado (${age_hours}h): $backup_path"
  fi
}

check_recent_session_audit_backup() {
  require_command find

  if [[ ! -d "$BACKUP_DIR" ]]; then
    log_warn "Backup de auditoria SSH nao validado; diretorio ausente: $BACKUP_DIR"
    return
  fi

  local latest_backup
  latest_backup="$(find "$BACKUP_DIR" -type f \( -name 'nodeaccess-session-audit-*.manifest.json' -o -name 'nodeaccess-session-audit-*.tar.gz' \) -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 || true)"
  if [[ -z "$latest_backup" ]]; then
    log_warn "Nenhum backup de auditoria SSH encontrado em $BACKUP_DIR"
    return
  fi

  local mtime_raw="${latest_backup%% *}"
  local backup_path="${latest_backup#* }"
  local mtime="${mtime_raw%.*}"
  local now
  now="$(date +%s)"

  local age_hours
  age_hours=$(((now - mtime) / 3600))

  if (( age_hours > MAX_BACKUP_AGE_HOURS )); then
    log_warn "Backup de auditoria SSH antigo (${age_hours}h; limite ${MAX_BACKUP_AGE_HOURS}h): $backup_path"
  else
    log_ok "Backup de auditoria SSH recente encontrado (${age_hours}h): $backup_path"
  fi
}

check_recent_user_avatar_backup() {
  require_command find

  if [[ ! -d "$BACKUP_DIR" ]]; then
    log_warn "Backup de avatares nao validado; diretorio ausente: $BACKUP_DIR"
    return
  fi

  local latest_backup
  latest_backup="$(find "$BACKUP_DIR" -type f \( -name 'nodeaccess-user-avatars-*.manifest.json' -o -name 'nodeaccess-user-avatars-*.tar.gz' \) -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 || true)"
  if [[ -z "$latest_backup" ]]; then
    log_warn "Nenhum backup de avatares encontrado em $BACKUP_DIR"
    return
  fi

  local mtime_raw="${latest_backup%% *}"
  local backup_path="${latest_backup#* }"
  local mtime="${mtime_raw%.*}"
  local now
  now="$(date +%s)"

  local age_hours
  age_hours=$(((now - mtime) / 3600))

  if (( age_hours > MAX_BACKUP_AGE_HOURS )); then
    log_warn "Backup de avatares antigo (${age_hours}h; limite ${MAX_BACKUP_AGE_HOURS}h): $backup_path"
  else
    log_ok "Backup de avatares recente encontrado (${age_hours}h): $backup_path"
  fi
}

build_curl_tls_args() {
  local url="$1"
  CURL_TLS_ARGS=()
  if [[ "$DOCTOR_HEALTH_INSECURE" == "true" ]]; then
    CURL_TLS_ARGS=(-k)
    return
  fi

  if [[ "$TLS_MODE" == "selfsigned" && "$url" =~ ^https:// ]]; then
    CURL_TLS_ARGS=(-k)
  fi
}

check_health_response() {
  local label="$1"
  local url="$2"
  local response_file="/tmp/nodeaccess-doctor-health-${label//[^a-zA-Z0-9]/-}.$$"
  local status_code

  build_curl_tls_args "$url"
  if ! status_code="$(curl -sS -o "$response_file" -w '%{http_code}' "${CURL_TLS_ARGS[@]}" "$url")"; then
    log_warn "${label}: falha ao consultar ${url}"
    rm -f "$response_file"
    return
  fi

  if [[ "$status_code" != 2* ]]; then
    log_warn "${label}: endpoint retornou HTTP ${status_code}"
    if [[ "$DOCTOR_OUTPUT" == "text" ]]; then
      cat "$response_file" || true
    fi
    rm -f "$response_file"
    return
  fi

  if grep -q '"status":"ok"' "$response_file"; then
    log_ok "${label}: health ok"
  elif grep -q '"status":"degraded"' "$response_file"; then
    log_warn "${label}: health degraded"
    if [[ "$DOCTOR_OUTPUT" == "text" ]]; then
      cat "$response_file" || true
    fi
  elif grep -q '"status":"down"' "$response_file"; then
    log_warn "${label}: health down"
    if [[ "$DOCTOR_OUTPUT" == "text" ]]; then
      cat "$response_file" || true
    fi
  else
    log_warn "${label}: resposta de health inesperada"
    if [[ "$DOCTOR_OUTPUT" == "text" ]]; then
      cat "$response_file" || true
    fi
  fi

  rm -f "$response_file"
}

check_deep_health() {
  local app_base_url="${APP_URL_OVERRIDE:-${APP_URL:-}}"
  local api_health_url="$API_DEEP_HEALTH_URL"

  if [[ -z "$api_health_url" ]]; then
    if [[ -z "$app_base_url" ]]; then
      log_warn "APP_URL nao definido e API_DEEP_HEALTH_URL ausente; deep health da API ignorado"
    else
      app_base_url="${app_base_url%/}"
      api_health_url="${app_base_url}${API_DEEP_HEALTH_PATH}"
    fi
  fi

  if [[ -n "$api_health_url" ]]; then
    emit_info "[nodeaccess] Verificando deep health da API: ${api_health_url}"
    check_health_response "api-deep" "$api_health_url"
  fi

  if [[ -n "$GATEWAY_DEEP_HEALTH_URL" ]]; then
    emit_info "[nodeaccess] Verificando deep health do gateway: ${GATEWAY_DEEP_HEALTH_URL}"
    check_health_response "gateway-deep" "$GATEWAY_DEEP_HEALTH_URL"
  else
    log_warn "GATEWAY_DEEP_HEALTH_URL vazio; deep health do gateway ignorado"
  fi
}

main() {
  require_command docker
  require_command bash
  require_command curl

  check_file "$ENV_FILE"
  check_file "$COMPOSE_FILE"
  check_file "$VALIDATE_ENV_SCRIPT"
  check_file "$SMOKE_CHECK_SCRIPT"
  check_file "$ENV_LOADER_SCRIPT"
  load_env
  resolve_tls_config

  emit_info "[nodeaccess] Validando .env..."
  local validate_error="/tmp/nodeaccess-doctor-validate.$$"
  if ! TLS_MODE="$TLS_MODE" bash "$VALIDATE_ENV_SCRIPT" "$ENV_FILE" >/dev/null 2>"$validate_error"; then
    local validate_message
    validate_message="$(head -n 1 "$validate_error" || true)"
    rm -f "$validate_error"
    log_fail "Ambiente invalido${validate_message:+: $validate_message}"
  fi
  rm -f "$validate_error"
  log_ok "Ambiente valido"

  emit_info "[nodeaccess] Validando docker compose..."
  local compose_error="/tmp/nodeaccess-doctor-compose.$$"
  if ! run_compose config >/dev/null 2>"$compose_error"; then
    local compose_message
    compose_message="$(head -n 1 "$compose_error" || true)"
    rm -f "$compose_error"
    log_fail "Docker compose invalido${compose_message:+: $compose_message}"
  fi
  rm -f "$compose_error"
  check_compose_services
  check_certs
  check_images
  check_compose_ps
  check_disk_space
  check_recent_backup
  check_recent_session_audit_backup
  check_recent_user_avatar_backup

  if [[ "$RUN_SMOKE_CHECK" == "true" ]]; then
    emit_info "[nodeaccess] Executando smoke check..."
    if [[ "$DOCTOR_OUTPUT" == "json" ]]; then
      local smoke_error="/tmp/nodeaccess-doctor-smoke.$$"
      if ENV_FILE="$ENV_FILE" bash "$SMOKE_CHECK_SCRIPT" >/dev/null 2>"$smoke_error"; then
        log_ok "Smoke check concluido"
      else
        local smoke_message
        smoke_message="$(head -n 1 "$smoke_error" || true)"
        log_warn "Smoke check falhou${smoke_message:+: $smoke_message}"
      fi
      rm -f "$smoke_error"
    else
      if ENV_FILE="$ENV_FILE" bash "$SMOKE_CHECK_SCRIPT"; then
        log_ok "Smoke check concluido"
      else
        log_warn "Smoke check falhou"
      fi
    fi
  else
    log_warn "Smoke check nao executado. Use RUN_SMOKE_CHECK=true para validar health."
  fi

  if [[ "$RUN_DEEP_HEALTH_CHECK" == "true" ]]; then
    emit_info "[nodeaccess] Executando deep health check..."
    check_deep_health
  else
    emit_info "[nodeaccess] Deep health nao executado. Use RUN_DEEP_HEALTH_CHECK=true para diagnostico detalhado."
  fi

  print_summary
}

main "$@"
