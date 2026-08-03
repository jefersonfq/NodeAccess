#!/usr/bin/env bash
set -euo pipefail

# Valida prontidao de estado para HA/warm standby.
# Nao altera a stack. Apenas valida ambiente, diretorios stateful, backups e,
# opcionalmente, endpoints de health/observabilidade.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
SESSION_AUDIT_STORAGE_DIR="${SESSION_AUDIT_STORAGE_DIR:-}"
USER_AVATAR_STORAGE_DIR="${USER_AVATAR_STORAGE_DIR:-}"
SESSION_AUDIT_HOST_DIR="${SESSION_AUDIT_HOST_DIR:-}"
USER_AVATAR_HOST_DIR="${USER_AVATAR_HOST_DIR:-}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-30}"
RUN_HEALTH_CHECKS="${RUN_HEALTH_CHECKS:-false}"
RUN_OBSERVABILITY_CHECK="${RUN_OBSERVABILITY_CHECK:-false}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:3000/health/ready}"
GATEWAY_HEALTH_URL="${GATEWAY_HEALTH_URL:-http://127.0.0.1:3001/health/ready}"
OBSERVABILITY_URL="${OBSERVABILITY_URL:-http://127.0.0.1:3000/api/v1/admin/observability/summary}"
HA_READINESS_OUTPUT="${HA_READINESS_OUTPUT:-text}"

WARNINGS=0
FAILURES=0
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
  if [[ "$HA_READINESS_OUTPUT" == "text" ]]; then
    echo "$1"
  fi
}

log_ok() {
  record_check "ok" "$1"
  if [[ "$HA_READINESS_OUTPUT" == "text" ]]; then
    echo "[ok] $1"
  fi
}

log_warn() {
  record_check "warn" "$1"
  WARNINGS=$((WARNINGS + 1))
  if [[ "$HA_READINESS_OUTPUT" == "text" ]]; then
    echo "[warn] $1"
  fi
}

log_fail() {
  record_check "fail" "$1"
  FAILURES=$((FAILURES + 1))
  if [[ "$HA_READINESS_OUTPUT" == "text" ]]; then
    echo "[fail] $1"
  fi
}

print_summary() {
  local status="ok"
  if [[ "$FAILURES" -gt 0 ]]; then
    status="down"
  elif [[ "$WARNINGS" -gt 0 ]]; then
    status="degraded"
  fi

  if [[ "$HA_READINESS_OUTPUT" == "json" ]]; then
    printf '{'
    printf '"status":"%s",' "$status"
    printf '"failures":%s,' "$FAILURES"
    printf '"warnings":%s,' "$WARNINGS"
    printf '"timestamp":"%s",' "$(date -Iseconds)"
    printf '"config":{'
    printf '"envFile":"%s",' "$(json_escape "$ENV_FILE")"
    printf '"backupDir":"%s",' "$(json_escape "$BACKUP_DIR")"
    printf '"sessionAuditStorageDir":"%s",' "$(json_escape "$SESSION_AUDIT_STORAGE_DIR")"
    printf '"userAvatarStorageDir":"%s",' "$(json_escape "$USER_AVATAR_STORAGE_DIR")"
    printf '"maxBackupAgeHours":%s,' "$MAX_BACKUP_AGE_HOURS"
    printf '"runHealthChecks":%s,' "$(if [[ "$RUN_HEALTH_CHECKS" == "true" ]]; then echo true; else echo false; fi)"
    printf '"runObservabilityCheck":%s' "$(if [[ "$RUN_OBSERVABILITY_CHECK" == "true" ]]; then echo true; else echo false; fi)"
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

  echo "[nodeaccess] HA state readiness concluido."
  echo "- status: $status"
  echo "- failures: $FAILURES"
  echo "- warnings: $WARNINGS"
  echo "- env_file: $ENV_FILE"
  echo "- backup_dir: $BACKUP_DIR"
  echo "- session_audit_storage_dir: $SESSION_AUDIT_STORAGE_DIR"
  echo "- user_avatar_storage_dir: $USER_AVATAR_STORAGE_DIR"
}

finish() {
  print_summary
  if [[ "$FAILURES" -gt 0 ]]; then
    exit 1
  fi
}

require_output_mode() {
  case "$HA_READINESS_OUTPUT" in
    text|json)
      ;;
    *)
      echo "[fail] HA_READINESS_OUTPUT invalido: $HA_READINESS_OUTPUT" >&2
      exit 1
      ;;
  esac
}

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    log_fail ".env ausente: $ENV_FILE"
    return
  fi
  log_ok ".env encontrado"

  if [[ ! -f "$ENV_LOADER_SCRIPT" ]]; then
    log_fail "Carregador de ambiente ausente: $ENV_LOADER_SCRIPT"
    return
  fi

  source "$ENV_LOADER_SCRIPT"
  load_env_file "$ENV_FILE"

  SESSION_AUDIT_STORAGE_DIR="${SESSION_AUDIT_STORAGE_DIR:-${SESSION_AUDIT_HOST_DIR:-}}"
  USER_AVATAR_STORAGE_DIR="${USER_AVATAR_STORAGE_DIR:-${USER_AVATAR_HOST_DIR:-}}"

  if [[ -z "$SESSION_AUDIT_STORAGE_DIR" ]] && command -v docker >/dev/null 2>&1; then
    SESSION_AUDIT_STORAGE_DIR="$(
      docker volume inspect "${COMPOSE_PROJECT_NAME}_session_audit_data" \
        --format '{{.Mountpoint}}' 2>/dev/null || true
    )"
  fi

  if [[ -z "$USER_AVATAR_STORAGE_DIR" ]] && command -v docker >/dev/null 2>&1; then
    USER_AVATAR_STORAGE_DIR="$(
      docker volume inspect "${COMPOSE_PROJECT_NAME}_user_avatar_data" \
        --format '{{.Mountpoint}}' 2>/dev/null || true
    )"
  fi

  SESSION_AUDIT_STORAGE_DIR="${SESSION_AUDIT_STORAGE_DIR:-/tmp/nodeaccess-session-audit}"
  USER_AVATAR_STORAGE_DIR="${USER_AVATAR_STORAGE_DIR:-/tmp/nodeaccess-user-avatars}"
}

check_required_env() {
  local missing=0
  local var_name
  for var_name in DATABASE_URL REDIS_URL JWT_SECRET PEM_ENCRYPTION_KEY; do
    if [[ -z "${!var_name:-}" ]]; then
      log_fail "$var_name ausente no ambiente"
      missing=1
    else
      log_ok "$var_name presente"
    fi
  done
  [[ "$missing" -eq 0 ]] || return

  [[ "$DATABASE_URL" =~ ^mysql:// ]] \
    && log_ok "DATABASE_URL usa mysql://" \
    || log_fail "DATABASE_URL invalido: esperado mysql://"

  [[ "$REDIS_URL" =~ ^redis:// ]] \
    && log_ok "REDIS_URL usa redis://" \
    || log_fail "REDIS_URL invalido: esperado redis://"

  [[ "${#JWT_SECRET}" -ge 32 ]] \
    && log_ok "JWT_SECRET com tamanho minimo" \
    || log_fail "JWT_SECRET com menos de 32 caracteres"

  [[ "$PEM_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]] \
    && log_ok "PEM_ENCRYPTION_KEY em formato valido" \
    || log_fail "PEM_ENCRYPTION_KEY invalida; esperado hex de 64 caracteres"
}

probe_directory() {
  local label="$1"
  local dir_path="$2"
  local probe_file

  if [[ -z "$dir_path" ]]; then
    log_fail "$label sem caminho configurado"
    return
  fi

  if [[ ! -d "$dir_path" ]]; then
    log_fail "$label ausente: $dir_path"
    return
  fi

  probe_file="${dir_path}/.nodeaccess-ha-readiness.$$"
  if printf 'nodeaccess-ha-readiness\n' >"$probe_file" 2>/dev/null; then
    if [[ "$(cat "$probe_file" 2>/dev/null)" == "nodeaccess-ha-readiness" ]]; then
      log_ok "$label permite escrita/leitura"
    else
      log_fail "$label falhou no readback: $dir_path"
    fi
    rm -f "$probe_file"
  else
    log_fail "$label sem permissao de escrita: $dir_path"
  fi
}

latest_file() {
  local pattern="$1"
  find "$BACKUP_DIR" -type f -name "$pattern" -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-
}

check_recent_file() {
  local label="$1"
  local pattern="$2"
  local required="$3"
  local latest
  latest="$(latest_file "$pattern")"

  if [[ -z "$latest" ]]; then
    if [[ "$required" == "true" ]]; then
      log_fail "$label ausente em $BACKUP_DIR"
    else
      log_warn "$label ausente em $BACKUP_DIR"
    fi
    return
  fi

  local mtime_raw now_raw age_hours
  mtime_raw="$(stat -c '%Y' "$latest" 2>/dev/null || echo 0)"
  now_raw="$(date +%s)"
  age_hours="$(( (now_raw - mtime_raw) / 3600 ))"
  if [[ "$age_hours" -gt "$MAX_BACKUP_AGE_HOURS" ]]; then
    log_warn "$label antigo (${age_hours}h; limite ${MAX_BACKUP_AGE_HOURS}h): $latest"
  else
    log_ok "$label recente (${age_hours}h): $latest"
  fi
}

check_backups() {
  if [[ ! -d "$BACKUP_DIR" ]]; then
    log_fail "Diretorio de backups ausente: $BACKUP_DIR"
    return
  fi

  log_ok "Diretorio de backups encontrado"
  check_recent_file "Backup MySQL" 'nodeaccess-mysql-*.manifest.json' true
  check_recent_file "Backup de auditoria SSH" 'nodeaccess-session-audit-*.manifest.json' false
  check_recent_file "Backup de avatares de usuario" 'nodeaccess-user-avatars-*.manifest.json' false
}

check_http_status() {
  local label="$1"
  local url="$2"
  local body_file="/tmp/nodeaccess-ha-readiness-${label//[^a-zA-Z0-9]/-}.$$"
  local status_code

  if ! command -v curl >/dev/null 2>&1; then
    log_warn "curl ausente; $label ignorado"
    return
  fi

  status_code="$(curl -fsS -m 5 -o "$body_file" -w '%{http_code}' "$url" 2>/dev/null || true)"
  if [[ "$status_code" == "200" ]]; then
    log_ok "$label respondeu HTTP 200"
  elif [[ -z "$status_code" ]]; then
    log_warn "$label nao respondeu: $url"
  else
    log_warn "$label respondeu HTTP $status_code: $url"
  fi
  rm -f "$body_file"
}

main() {
  require_output_mode
  emit_info "[nodeaccess] Validando readiness de estado para HA..."
  load_env
  check_required_env
  probe_directory "Storage de auditoria SSH" "$SESSION_AUDIT_STORAGE_DIR"
  probe_directory "Storage de avatares de usuario" "$USER_AVATAR_STORAGE_DIR"
  check_backups

  if [[ "$RUN_HEALTH_CHECKS" == "true" ]]; then
    check_http_status "API readiness" "$API_HEALTH_URL"
    check_http_status "Gateway readiness" "$GATEWAY_HEALTH_URL"
  else
    emit_info "[nodeaccess] Health checks ignorados. Use RUN_HEALTH_CHECKS=true para validar API/gateway."
  fi

  if [[ "$RUN_OBSERVABILITY_CHECK" == "true" ]]; then
    check_http_status "Observabilidade admin" "$OBSERVABILITY_URL"
  else
    emit_info "[nodeaccess] Observabilidade ignorada. Use RUN_OBSERVABILITY_CHECK=true para validar o endpoint admin."
  fi

  finish
}

main "$@"
