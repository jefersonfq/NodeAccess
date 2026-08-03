#!/usr/bin/env bash
set -euo pipefail

# Harness seguro de prontidao para falhas.
# Por padrao nao para containers e nao altera a stack.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

REPORT_DIR="${REPORT_DIR:-${PROJECT_ROOT}/tools/deploy/reports}"
REPORT_PATH="${REPORT_PATH:-${REPORT_DIR}/failure-readiness-$(date +%Y%m%d-%H%M%S).txt}"
TLS_MODE="${TLS_MODE:-off}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:3000/health/ready}"
API_DEEP_HEALTH_URL="${API_DEEP_HEALTH_URL:-http://127.0.0.1:3000/health/deep}"
GATEWAY_HEALTH_URL="${GATEWAY_HEALTH_URL:-http://127.0.0.1:3001/health/ready}"
GATEWAY_DEEP_HEALTH_URL="${GATEWAY_DEEP_HEALTH_URL:-http://127.0.0.1:3001/health/deep}"
RUN_SIMULATED_FAILURES="${RUN_SIMULATED_FAILURES:-true}"
RUN_DESTRUCTIVE_FAILURES="${RUN_DESTRUCTIVE_FAILURES:-false}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
ENV_FILE="${ENV_FILE:-.env}"
DESTRUCTIVE_SERVICES="${DESTRUCTIVE_SERVICES:-api ssh-gateway}"
RECOVERY_ATTEMPTS="${RECOVERY_ATTEMPTS:-12}"
RECOVERY_SLEEP_SECONDS="${RECOVERY_SLEEP_SECONDS:-5}"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

mkdir -p "$REPORT_DIR"

log_line() {
  echo "$1" | tee -a "$REPORT_PATH"
}

mark_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  log_line "[pass] $1"
}

mark_warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  log_line "[warn] $1"
}

mark_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  log_line "[fail] $1"
}

run_expect_success() {
  local label="$1"
  shift
  log_line "[nodeaccess][failure] ${label}"
  if "$@" >>"$REPORT_PATH" 2>&1; then
    mark_pass "$label"
  else
    mark_fail "$label"
  fi
}

docker_compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$PROJECT_ROOT/$COMPOSE_FILE" --env-file "$PROJECT_ROOT/$ENV_FILE" "$@"
}

run_doctor_quiet() {
  env TLS_MODE="$TLS_MODE" \
    RUN_SMOKE_CHECK=true \
    RUN_DEEP_HEALTH_CHECK=true \
    API_HEALTH_URL="$API_HEALTH_URL" \
    API_DEEP_HEALTH_URL="$API_DEEP_HEALTH_URL" \
    GATEWAY_HEALTH_URL="$GATEWAY_HEALTH_URL" \
    GATEWAY_DEEP_HEALTH_URL="$GATEWAY_DEEP_HEALTH_URL" \
    bash "$PROJECT_ROOT/scripts/deploy/doctor-nodeaccess.sh"
}

run_expect_warning() {
  local label="$1"
  local expected="$2"
  shift 2
  local tmp_output
  tmp_output="$(mktemp)"

  log_line "[nodeaccess][failure] ${label}"
  if "$@" >"$tmp_output" 2>&1; then
    cat "$tmp_output" >>"$REPORT_PATH"
    if grep -Fq "$expected" "$tmp_output"; then
      mark_pass "${label}: alerta esperado detectado"
    else
      mark_fail "${label}: comando passou, mas nao emitiu alerta esperado: ${expected}"
    fi
  else
    cat "$tmp_output" >>"$REPORT_PATH"
    mark_fail "${label}: comando falhou antes de emitir alerta esperado"
  fi

  rm -f "$tmp_output"
}

wait_for_recovery() {
  local label="$1"
  local attempt

  for attempt in $(seq 1 "$RECOVERY_ATTEMPTS"); do
    log_line "[nodeaccess][failure] ${label}: tentativa de recuperacao ${attempt}/${RECOVERY_ATTEMPTS}"
    if run_doctor_quiet >>"$REPORT_PATH" 2>&1; then
      return 0
    fi
    sleep "$RECOVERY_SLEEP_SECONDS"
  done

  return 1
}

run_restart_scenario() {
  local service="$1"
  local label="Reinicio controlado do servico ${service}"
  local container_ids

  log_line "[nodeaccess][failure] ${label}"

  if ! docker_compose config --services | grep -Fxq "$service"; then
    mark_warn "${label}: servico nao existe no compose informado"
    return 0
  fi

  container_ids="$(docker_compose ps -q "$service" 2>>"$REPORT_PATH" || true)"
  if [[ -z "$container_ids" ]]; then
    mark_warn "${label}: sem container ativo no compose; restart ignorado para evitar falso positivo"
    return 0
  fi

  if docker_compose restart "$service" >>"$REPORT_PATH" 2>&1; then
    log_line "[nodeaccess][failure] ${label}: restart solicitado"
  else
    mark_fail "${label}: falha ao solicitar restart"
    return 0
  fi

  if wait_for_recovery "$label"; then
    mark_pass "${label}: health recuperado"
  else
    mark_fail "${label}: health nao recuperou no tempo esperado"
  fi
}

log_line "# NodeAccess Failure Readiness Harness"
log_line "- started_at: $(date -Iseconds)"
log_line "- mode: safe"
log_line "- report: $REPORT_PATH"
log_line "- destructive_failures: $RUN_DESTRUCTIVE_FAILURES"
log_line "- destructive_services: $DESTRUCTIVE_SERVICES"

run_expect_success "Baseline doctor com smoke/deep" \
  env TLS_MODE="$TLS_MODE" \
    RUN_SMOKE_CHECK=true \
    RUN_DEEP_HEALTH_CHECK=true \
    API_HEALTH_URL="$API_HEALTH_URL" \
    API_DEEP_HEALTH_URL="$API_DEEP_HEALTH_URL" \
    GATEWAY_HEALTH_URL="$GATEWAY_HEALTH_URL" \
    GATEWAY_DEEP_HEALTH_URL="$GATEWAY_DEEP_HEALTH_URL" \
    bash "$PROJECT_ROOT/scripts/deploy/doctor-nodeaccess.sh"

run_expect_success "Check de artefatos DR" \
  env TLS_MODE="$TLS_MODE" bash "$PROJECT_ROOT/scripts/backup/check-dr-artifacts.sh"

if [[ "$RUN_SIMULATED_FAILURES" == "true" ]]; then
  run_expect_warning "Degradacao simulada: API readiness indisponivel" "Smoke check falhou" \
    env TLS_MODE="$TLS_MODE" \
      RUN_SMOKE_CHECK=true \
      RUN_DEEP_HEALTH_CHECK=false \
      API_HEALTH_URL="http://127.0.0.1:1/health/ready" \
      GATEWAY_HEALTH_URL="$GATEWAY_HEALTH_URL" \
      bash "$PROJECT_ROOT/scripts/deploy/doctor-nodeaccess.sh"

  run_expect_warning "Degradacao simulada: API deep indisponivel" "api-deep: falha ao consultar" \
    env TLS_MODE="$TLS_MODE" \
      RUN_SMOKE_CHECK=false \
      RUN_DEEP_HEALTH_CHECK=true \
      API_DEEP_HEALTH_URL="http://127.0.0.1:1/health/deep" \
      GATEWAY_DEEP_HEALTH_URL="$GATEWAY_DEEP_HEALTH_URL" \
      bash "$PROJECT_ROOT/scripts/deploy/doctor-nodeaccess.sh"

  run_expect_warning "Degradacao simulada: backup MySQL vencido" "Backup mais recente antigo" \
    env TLS_MODE="$TLS_MODE" MAX_BACKUP_AGE_HOURS=0 \
      bash "$PROJECT_ROOT/scripts/deploy/doctor-nodeaccess.sh"
else
  mark_warn "Falhas simuladas ignoradas por RUN_SIMULATED_FAILURES=false"
fi

if [[ "$RUN_DESTRUCTIVE_FAILURES" == "true" ]]; then
  log_line "[nodeaccess][failure] Cenarios destrutivos habilitados."
  for service in $DESTRUCTIVE_SERVICES; do
    run_restart_scenario "$service"
  done
else
  mark_warn "Cenarios destrutivos ignorados por RUN_DESTRUCTIVE_FAILURES=false"
fi

log_line "[nodeaccess][failure] Harness concluido."
log_line "- pass: $PASS_COUNT"
log_line "- warn: $WARN_COUNT"
log_line "- fail: $FAIL_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
