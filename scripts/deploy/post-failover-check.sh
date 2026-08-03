#!/usr/bin/env bash
set -euo pipefail

# Validacao apos a troca manual de DNS, VIP, proxy ou balanceador. Nao altera
# trafego; apenas confirma se o destino promovido esta saudavel.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
TLS_MODE="${TLS_MODE:-off}"
RUN_DOCTOR="${RUN_DOCTOR:-true}"
RUN_ENDPOINT_GATES="${RUN_ENDPOINT_GATES:-true}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:3000/health/ready}"
API_DEEP_HEALTH_URL="${API_DEEP_HEALTH_URL:-http://127.0.0.1:3000/health/deep}"
GATEWAY_HEALTH_URL="${GATEWAY_HEALTH_URL:-http://127.0.0.1:3001/health/ready}"
GATEWAY_DEEP_HEALTH_URL="${GATEWAY_DEEP_HEALTH_URL:-http://127.0.0.1:3001/health/deep}"
DOCTOR_SCRIPT="${DOCTOR_SCRIPT:-${SCRIPT_DIR}/doctor-nodeaccess.sh}"

FAILURES=0
WARNINGS=0
STEP_COUNT=0

run_step() {
  local label="$1"
  shift

  STEP_COUNT=$((STEP_COUNT + 1))
  echo "[nodeaccess][post-failover] ${STEP_COUNT}. ${label}"

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
    warn_skip "Gates de endpoint ignorados por RUN_ENDPOINT_GATES=false."
    return
  fi

  check_required_url "API ready" "$API_HEALTH_URL" || failed=1
  check_required_url "API deep" "$API_DEEP_HEALTH_URL" || failed=1
  check_required_url "Gateway ready" "$GATEWAY_HEALTH_URL" || failed=1
  check_required_url "Gateway deep" "$GATEWAY_DEEP_HEALTH_URL" || failed=1

  return "$failed"
}

run_doctor() {
  if [[ ! -f "$DOCTOR_SCRIPT" ]]; then
    echo "Doctor ausente: $DOCTOR_SCRIPT" >&2
    return 1
  fi

  TLS_MODE="$TLS_MODE" \
    RUN_SMOKE_CHECK=true \
    RUN_DEEP_HEALTH_CHECK=true \
    API_HEALTH_URL="$API_HEALTH_URL" \
    API_DEEP_HEALTH_URL="$API_DEEP_HEALTH_URL" \
    GATEWAY_HEALTH_URL="$GATEWAY_HEALTH_URL" \
    GATEWAY_DEEP_HEALTH_URL="$GATEWAY_DEEP_HEALTH_URL" \
    BACKUP_DIR="$BACKUP_DIR" \
    bash "$DOCTOR_SCRIPT"
}

echo "[nodeaccess][post-failover] Validando destino promovido."
echo "- api_health_url: $API_HEALTH_URL"
echo "- gateway_health_url: $GATEWAY_HEALTH_URL"
echo "- backup_dir: $BACKUP_DIR"

run_step "Gates obrigatorios de API/gateway" run_endpoint_gates

if [[ "$RUN_DOCTOR" == "true" ]]; then
  run_step "Doctor pos-failover" run_doctor
else
  warn_skip "Doctor ignorado por RUN_DOCTOR=false."
fi

if [[ "$FAILURES" -gt 0 ]]; then
  echo "[nodeaccess][post-failover] Pos-failover falhou."
  echo "- failures: $FAILURES"
  echo "- warnings: $WARNINGS"
  echo "- acao_sugerida: revisar roteamento/VIP/proxy e manter plano de rollback disponivel"
  exit 1
fi

echo "[nodeaccess][post-failover] Pos-failover aprovado."
echo "- failures: $FAILURES"
echo "- warnings: $WARNINGS"
echo "- validacao_manual: login admin, hosts, terminal SSH, auditoria, SFTP e observabilidade"
