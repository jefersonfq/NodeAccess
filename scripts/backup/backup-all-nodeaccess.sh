#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${PROJECT_ROOT}/docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
OUTPUT_DIR="${1:-${PROJECT_ROOT}/backups}"

MYSQL_BACKUP_SCRIPT="${MYSQL_BACKUP_SCRIPT:-${SCRIPT_DIR}/backup-mysql.sh}"
SESSION_AUDIT_BACKUP_SCRIPT="${SESSION_AUDIT_BACKUP_SCRIPT:-${SCRIPT_DIR}/backup-session-audit.sh}"
USER_AVATAR_BACKUP_SCRIPT="${USER_AVATAR_BACKUP_SCRIPT:-${SCRIPT_DIR}/backup-user-avatars.sh}"
DR_ARTIFACT_CHECK_SCRIPT="${DR_ARTIFACT_CHECK_SCRIPT:-${SCRIPT_DIR}/check-dr-artifacts.sh}"

RUN_MYSQL_BACKUP="${RUN_MYSQL_BACKUP:-true}"
RUN_SESSION_AUDIT_BACKUP="${RUN_SESSION_AUDIT_BACKUP:-true}"
RUN_USER_AVATAR_BACKUP="${RUN_USER_AVATAR_BACKUP:-true}"
RUN_DR_ARTIFACT_CHECK="${RUN_DR_ARTIFACT_CHECK:-true}"
REQUIRE_STATEFUL_BACKUPS="${REQUIRE_STATEFUL_BACKUPS:-true}"

mkdir -p "$OUTPUT_DIR"

run_required_backup() {
  local label="$1"
  local script_path="$2"

  if [[ ! -f "$script_path" ]]; then
    echo "Script obrigatorio de backup nao encontrado: $script_path" >&2
    exit 1
  fi

  echo "[nodeaccess] Executando backup obrigatorio: $label"
  ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
    bash "$script_path" "$OUTPUT_DIR"
}

run_stateful_backup() {
  local label="$1"
  local script_path="$2"

  if [[ ! -f "$script_path" ]]; then
    if [[ "$REQUIRE_STATEFUL_BACKUPS" == "true" ]]; then
      echo "Script de backup stateful nao encontrado: $script_path" >&2
      exit 1
    fi
    echo "[nodeaccess] Backup de $label ignorado; script ausente: $script_path"
    return
  fi

  echo "[nodeaccess] Executando backup stateful: $label"
  if ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
    bash "$script_path" "$OUTPUT_DIR"; then
    return
  fi

  if [[ "$REQUIRE_STATEFUL_BACKUPS" == "true" ]]; then
    echo "Backup stateful falhou: $label" >&2
    exit 1
  fi

  echo "[nodeaccess] Backup de $label falhou; continuando porque REQUIRE_STATEFUL_BACKUPS=false." >&2
}

if [[ "$RUN_MYSQL_BACKUP" == "true" ]]; then
  run_required_backup "mysql" "$MYSQL_BACKUP_SCRIPT"
fi

if [[ "$RUN_SESSION_AUDIT_BACKUP" == "true" ]]; then
  run_stateful_backup "auditoria SSH" "$SESSION_AUDIT_BACKUP_SCRIPT"
fi

if [[ "$RUN_USER_AVATAR_BACKUP" == "true" ]]; then
  run_stateful_backup "avatares de usuario" "$USER_AVATAR_BACKUP_SCRIPT"
fi

if [[ "$RUN_DR_ARTIFACT_CHECK" == "true" ]]; then
  if [[ ! -f "$DR_ARTIFACT_CHECK_SCRIPT" ]]; then
    echo "Script de validacao DR nao encontrado: $DR_ARTIFACT_CHECK_SCRIPT" >&2
    exit 1
  fi

  echo "[nodeaccess] Validando artefatos de backup gerados..."
  ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
    BACKUP_DIR="$OUTPUT_DIR" bash "$DR_ARTIFACT_CHECK_SCRIPT"
fi

echo "[nodeaccess] Backup agregado concluido."
echo "- output_dir: $OUTPUT_DIR"
echo "- run_mysql_backup: $RUN_MYSQL_BACKUP"
echo "- run_session_audit_backup: $RUN_SESSION_AUDIT_BACKUP"
echo "- run_user_avatar_backup: $RUN_USER_AVATAR_BACKUP"
echo "- run_dr_artifact_check: $RUN_DR_ARTIFACT_CHECK"
echo "- require_stateful_backups: $REQUIRE_STATEFUL_BACKUPS"
