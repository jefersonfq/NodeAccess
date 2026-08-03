#!/usr/bin/env bash
set -euo pipefail

# Orquestra validacoes para decidir se um no secundario/warm standby esta
# pronto para promocao. Nao promove trafego e nao altera a stack.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"
BACKUP_DIR_WAS_SET="${BACKUP_DIR+x}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
TLS_MODE="${TLS_MODE:-off}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:3000/health/ready}"
API_DEEP_HEALTH_URL="${API_DEEP_HEALTH_URL:-http://127.0.0.1:3000/health/deep}"
GATEWAY_HEALTH_URL="${GATEWAY_HEALTH_URL:-http://127.0.0.1:3001/health/ready}"
GATEWAY_DEEP_HEALTH_URL="${GATEWAY_DEEP_HEALTH_URL:-http://127.0.0.1:3001/health/deep}"
OBSERVABILITY_URL="${OBSERVABILITY_URL:-http://127.0.0.1:3000/api/v1/admin/observability/summary}"

DOCTOR_SCRIPT="${DOCTOR_SCRIPT:-${SCRIPT_DIR}/doctor-nodeaccess.sh}"
HA_STATE_READINESS_SCRIPT="${HA_STATE_READINESS_SCRIPT:-${SCRIPT_DIR}/ha-state-readiness.sh}"
DR_ARTIFACT_CHECK_SCRIPT="${DR_ARTIFACT_CHECK_SCRIPT:-${PROJECT_ROOT}/scripts/backup/check-dr-artifacts.sh}"
DR_VALIDATION_HARNESS="${DR_VALIDATION_HARNESS:-${PROJECT_ROOT}/tools/deploy/dr-validation-harness.sh}"

RUN_DOCTOR="${RUN_DOCTOR:-true}"
RUN_STATE_READINESS="${RUN_STATE_READINESS:-true}"
RUN_DR_ARTIFACT_CHECK="${RUN_DR_ARTIFACT_CHECK:-true}"
RUN_ISOLATED_RESTORE_CHECKS="${RUN_ISOLATED_RESTORE_CHECKS:-false}"
RUN_ENDPOINT_GATES="${RUN_ENDPOINT_GATES:-true}"
REQUIRE_DOCKER_ACCESS="${REQUIRE_DOCKER_ACCESS:-true}"

if [[ -z "$BACKUP_DIR_WAS_SET" && -f "$ENV_FILE" ]]; then
  ENV_BACKUP_DIR="$(sed -n 's/^BACKUP_DIR=//p' "$ENV_FILE" | tail -n 1)"
  BACKUP_DIR="${ENV_BACKUP_DIR:-$BACKUP_DIR}"
fi

FAILURES=0
WARNINGS=0
STEP_COUNT=0

run_step() {
  local label="$1"
  shift

  STEP_COUNT=$((STEP_COUNT + 1))
  echo "[nodeaccess][standby] ${STEP_COUNT}. ${label}"

  if "$@"; then
    echo "[ok] ${label}"
    return
  fi

  echo "[fail] ${label}" >&2
  FAILURES=$((FAILURES + 1))
}

warn_skip() {
  echo "[warn] $1"
  WARNINGS=$((WARNINGS + 1))
}

require_script() {
  local label="$1"
  local script_path="$2"

  if [[ -f "$script_path" ]]; then
    return 0
  fi

  echo "[fail] Script ausente para ${label}: ${script_path}" >&2
  return 1
}

run_doctor() {
  require_script "doctor" "$DOCTOR_SCRIPT" || return 1

  env TLS_MODE="$TLS_MODE" \
    RUN_SMOKE_CHECK=true \
    RUN_DEEP_HEALTH_CHECK=true \
    API_HEALTH_URL="$API_HEALTH_URL" \
    API_DEEP_HEALTH_URL="$API_DEEP_HEALTH_URL" \
    GATEWAY_HEALTH_URL="$GATEWAY_HEALTH_URL" \
    GATEWAY_DEEP_HEALTH_URL="$GATEWAY_DEEP_HEALTH_URL" \
    BACKUP_DIR="$BACKUP_DIR" \
    bash "$DOCTOR_SCRIPT"
}

run_state_readiness() {
  require_script "readiness de estado HA" "$HA_STATE_READINESS_SCRIPT" || return 1

  env ENV_FILE="$ENV_FILE" \
    BACKUP_DIR="$BACKUP_DIR" \
    RUN_HEALTH_CHECKS=true \
    RUN_OBSERVABILITY_CHECK=true \
    API_HEALTH_URL="$API_HEALTH_URL" \
    GATEWAY_HEALTH_URL="$GATEWAY_HEALTH_URL" \
    OBSERVABILITY_URL="$OBSERVABILITY_URL" \
    bash "$HA_STATE_READINESS_SCRIPT"
}

run_dr_artifact_check() {
  require_script "check DR" "$DR_ARTIFACT_CHECK_SCRIPT" || return 1

  env TLS_MODE="$TLS_MODE" \
    ENV_FILE="$ENV_FILE" \
    BACKUP_DIR="$BACKUP_DIR" \
    bash "$DR_ARTIFACT_CHECK_SCRIPT"
}

run_docker_gate() {
  if [[ "$REQUIRE_DOCKER_ACCESS" != "true" ]]; then
    warn_skip "Gate de Docker ignorado por REQUIRE_DOCKER_ACCESS=false."
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "docker nao encontrado no PATH" >&2
    return 1
  fi

  docker ps >/dev/null
}

check_required_url() {
  local label="$1"
  local url="$2"
  local status_code

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl nao encontrado no PATH" >&2
    return 1
  fi

  status_code="$(curl -fsS -m 5 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
  if [[ "$status_code" == "200" ]]; then
    return 0
  fi

  echo "${label} nao respondeu HTTP 200 (${status_code:-sem resposta}): ${url}" >&2
  return 1
}

run_endpoint_gates() {
  local failed=0

  if [[ "$RUN_ENDPOINT_GATES" != "true" ]]; then
    warn_skip "Gates obrigatorios de endpoint ignorados por RUN_ENDPOINT_GATES=false."
    return
  fi

  check_required_url "API ready" "$API_HEALTH_URL" || failed=1
  check_required_url "API deep" "$API_DEEP_HEALTH_URL" || failed=1
  check_required_url "Gateway ready" "$GATEWAY_HEALTH_URL" || failed=1
  check_required_url "Gateway deep" "$GATEWAY_DEEP_HEALTH_URL" || failed=1

  return "$failed"
}

run_isolated_restore_checks() {
  require_script "restore isolado DR" "$DR_VALIDATION_HARNESS" || return 1

  env TLS_MODE="$TLS_MODE" \
    ENV_FILE="$ENV_FILE" \
    BACKUP_DIR="$BACKUP_DIR" \
    RUN_DOCTOR=false \
    API_HEALTH_URL="$API_HEALTH_URL" \
    API_DEEP_HEALTH_URL="$API_DEEP_HEALTH_URL" \
    GATEWAY_HEALTH_URL="$GATEWAY_HEALTH_URL" \
    GATEWAY_DEEP_HEALTH_URL="$GATEWAY_DEEP_HEALTH_URL" \
    bash "$DR_VALIDATION_HARNESS"
}

run_step "Acesso ao Docker daemon" run_docker_gate

if [[ "$RUN_DOCTOR" == "true" ]]; then
  run_step "Doctor com smoke/deep health" run_doctor
else
  warn_skip "Doctor ignorado por RUN_DOCTOR=false."
fi

if [[ "$RUN_STATE_READINESS" == "true" ]]; then
  run_step "Readiness de estado HA" run_state_readiness
else
  warn_skip "Readiness de estado ignorado por RUN_STATE_READINESS=false."
fi

if [[ "$RUN_DR_ARTIFACT_CHECK" == "true" ]]; then
  run_step "Check de artefatos DR" run_dr_artifact_check
else
  warn_skip "Check DR ignorado por RUN_DR_ARTIFACT_CHECK=false."
fi

run_step "Gates obrigatorios de API/gateway" run_endpoint_gates

if [[ "$RUN_ISOLATED_RESTORE_CHECKS" == "true" ]]; then
  run_step "Restores isolados de DR" run_isolated_restore_checks
else
  warn_skip "Restores isolados ignorados. Use RUN_ISOLATED_RESTORE_CHECKS=true antes de promocao real."
fi

if [[ "$FAILURES" -gt 0 ]]; then
  echo "[nodeaccess][standby] Readiness de standby falhou."
  echo "- failures: $FAILURES"
  echo "- warnings: $WARNINGS"
  echo "- backup_dir: $BACKUP_DIR"
  exit 1
fi

echo "[nodeaccess][standby] Standby elegivel para promocao operacional."
echo "- failures: $FAILURES"
echo "- warnings: $WARNINGS"
echo "- backup_dir: $BACKUP_DIR"
echo "- run_isolated_restore_checks: $RUN_ISOLATED_RESTORE_CHECKS"
