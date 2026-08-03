#!/usr/bin/env bash
set -euo pipefail

# Validacao antes de trocar trafego para o standby. Nao altera DNS, VIP,
# balanceador, containers ou firewall.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
TLS_MODE="${TLS_MODE:-off}"
FAILOVER_TARGET="${FAILOVER_TARGET:-standby}"
TRAFFIC_SWITCH_METHOD="${TRAFFIC_SWITCH_METHOD:-manual}"
RUN_BACKUP_AGGREGATE="${RUN_BACKUP_AGGREGATE:-false}"
RUN_ISOLATED_RESTORE_CHECKS="${RUN_ISOLATED_RESTORE_CHECKS:-true}"

BACKUP_ALL_SCRIPT="${BACKUP_ALL_SCRIPT:-${PROJECT_ROOT}/scripts/backup/backup-all-nodeaccess.sh}"
STANDBY_READINESS_SCRIPT="${STANDBY_READINESS_SCRIPT:-${SCRIPT_DIR}/standby-readiness.sh}"

FAILURES=0
WARNINGS=0
STEP_COUNT=0

run_step() {
  local label="$1"
  shift

  STEP_COUNT=$((STEP_COUNT + 1))
  echo "[nodeaccess][pre-failover] ${STEP_COUNT}. ${label}"

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

  echo "Script ausente para ${label}: ${script_path}" >&2
  return 1
}

run_aggregate_backup() {
  require_script "backup agregado" "$BACKUP_ALL_SCRIPT" || return 1

  TLS_MODE="$TLS_MODE" BACKUP_DIR="$BACKUP_DIR" bash "$BACKUP_ALL_SCRIPT" "$BACKUP_DIR"
}

run_standby_readiness() {
  require_script "standby readiness" "$STANDBY_READINESS_SCRIPT" || return 1

  TLS_MODE="$TLS_MODE" \
    BACKUP_DIR="$BACKUP_DIR" \
    RUN_ISOLATED_RESTORE_CHECKS="$RUN_ISOLATED_RESTORE_CHECKS" \
    bash "$STANDBY_READINESS_SCRIPT"
}

echo "[nodeaccess][pre-failover] Validando troca manual de trafego."
echo "- failover_target: $FAILOVER_TARGET"
echo "- traffic_switch_method: $TRAFFIC_SWITCH_METHOD"
echo "- backup_dir: $BACKUP_DIR"
echo "- run_backup_aggregate: $RUN_BACKUP_AGGREGATE"
echo "- run_isolated_restore_checks: $RUN_ISOLATED_RESTORE_CHECKS"

if [[ "$RUN_BACKUP_AGGREGATE" == "true" ]]; then
  run_step "Backup agregado pre-failover" run_aggregate_backup
else
  warn_skip "Backup agregado ignorado. Use RUN_BACKUP_AGGREGATE=true em failover planejado."
fi

run_step "Standby readiness pre-failover" run_standby_readiness

if [[ "$FAILURES" -gt 0 ]]; then
  echo "[nodeaccess][pre-failover] Pre-failover bloqueado."
  echo "- failures: $FAILURES"
  echo "- warnings: $WARNINGS"
  exit 1
fi

echo "[nodeaccess][pre-failover] Pre-failover aprovado para troca manual."
echo "- failures: $FAILURES"
echo "- warnings: $WARNINGS"
echo "- proxima_acao: trocar ${TRAFFIC_SWITCH_METHOD} para ${FAILOVER_TARGET} e executar scripts/deploy/post-failover-check.sh"
echo "- lembrete: sessoes SSH/WebSocket ativas no no antigo podem cair e devem ser comunicadas aos usuarios"
