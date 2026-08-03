#!/usr/bin/env bash
set -euo pipefail

# Harness agregado de DR.
# Valida artefatos, restore MySQL isolado, restore de auditoria isolado,
# restore de avatares quando houver backup,
# e, opcionalmente, doctor com smoke/deep. Nao toca no banco atual.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"
RUN_DOCTOR="${RUN_DOCTOR:-true}"
RUN_RESTORE_MYSQL="${RUN_RESTORE_MYSQL:-true}"
RUN_RESTORE_SESSION_AUDIT="${RUN_RESTORE_SESSION_AUDIT:-true}"
RUN_RESTORE_USER_AVATARS="${RUN_RESTORE_USER_AVATARS:-true}"
TLS_MODE="${TLS_MODE:-off}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:3000/health/ready}"
API_DEEP_HEALTH_URL="${API_DEEP_HEALTH_URL:-http://127.0.0.1:3000/health/deep}"
GATEWAY_HEALTH_URL="${GATEWAY_HEALTH_URL:-http://127.0.0.1:3001/health/ready}"
GATEWAY_DEEP_HEALTH_URL="${GATEWAY_DEEP_HEALTH_URL:-http://127.0.0.1:3001/health/deep}"

STEP_COUNT=0
TEMP_DIRS=()

cleanup() {
  local dir_path
  for dir_path in "${TEMP_DIRS[@]}"; do
    rm -rf "$dir_path"
  done
}
trap cleanup EXIT

run_step() {
  local label="$1"
  shift
  STEP_COUNT=$((STEP_COUNT + 1))
  echo "[nodeaccess][dr] ${STEP_COUNT}. ${label}"
  "$@"
}

latest_file() {
  local pattern="$1"
  find "$BACKUP_DIR" -type f -name "$pattern" -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-
}

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Diretorio de backups ausente: $BACKUP_DIR" >&2
  exit 1
fi

MYSQL_BACKUP="$(latest_file 'nodeaccess-mysql-*.sql.gz')"
AUDIT_BACKUP="$(latest_file 'nodeaccess-session-audit-*.tar.gz')"
AVATAR_BACKUP="$(latest_file 'nodeaccess-user-avatars-*.tar.gz')"

if [[ -z "$MYSQL_BACKUP" ]]; then
  echo "Backup MySQL ausente em $BACKUP_DIR" >&2
  exit 1
fi

if [[ -z "$AUDIT_BACKUP" ]]; then
  echo "Backup de auditoria SSH ausente em $BACKUP_DIR" >&2
  exit 1
fi

run_step "Checando artefatos DR" \
  env TLS_MODE="$TLS_MODE" ENV_FILE="$ENV_FILE" BACKUP_DIR="$BACKUP_DIR" \
  bash "$PROJECT_ROOT/scripts/backup/check-dr-artifacts.sh"

if [[ "$RUN_RESTORE_MYSQL" == "true" ]]; then
  run_step "Restaurando MySQL em ambiente isolado" \
    bash "$PROJECT_ROOT/tools/deploy/restore-mysql-isolated-harness.sh" "$MYSQL_BACKUP"
else
  echo "[nodeaccess][dr] Restore MySQL isolado ignorado por RUN_RESTORE_MYSQL=false."
fi

if [[ "$RUN_RESTORE_SESSION_AUDIT" == "true" ]]; then
  run_step "Restaurando auditoria SSH em volume isolado" \
    bash "$PROJECT_ROOT/tools/deploy/restore-session-audit-isolated-harness.sh" "$AUDIT_BACKUP"
else
  echo "[nodeaccess][dr] Restore de auditoria isolado ignorado por RUN_RESTORE_SESSION_AUDIT=false."
fi

if [[ "$RUN_RESTORE_USER_AVATARS" == "true" && -n "$AVATAR_BACKUP" ]]; then
  AVATAR_RESTORE_DIR="$(mktemp -d)"
  TEMP_DIRS+=("$AVATAR_RESTORE_DIR")
  run_step "Restaurando avatares em diretorio isolado" \
    env ENV_FILE="$ENV_FILE" \
      USER_AVATAR_RESTORE_TARGET_DIR="$AVATAR_RESTORE_DIR" \
      bash "$PROJECT_ROOT/scripts/backup/restore-user-avatars.sh" "$AVATAR_BACKUP" --yes
elif [[ "$RUN_RESTORE_USER_AVATARS" == "true" ]]; then
  echo "[nodeaccess][dr] Restore de avatares ignorado: backup ausente em $BACKUP_DIR."
else
  echo "[nodeaccess][dr] Restore de avatares ignorado por RUN_RESTORE_USER_AVATARS=false."
fi

if [[ "$RUN_DOCTOR" == "true" ]]; then
  run_step "Executando doctor com smoke/deep" \
    env TLS_MODE="$TLS_MODE" \
      RUN_SMOKE_CHECK=true \
      RUN_DEEP_HEALTH_CHECK=true \
      API_HEALTH_URL="$API_HEALTH_URL" \
      API_DEEP_HEALTH_URL="$API_DEEP_HEALTH_URL" \
      GATEWAY_HEALTH_URL="$GATEWAY_HEALTH_URL" \
      GATEWAY_DEEP_HEALTH_URL="$GATEWAY_DEEP_HEALTH_URL" \
      BACKUP_DIR="$BACKUP_DIR" \
      bash "$PROJECT_ROOT/scripts/deploy/doctor-nodeaccess.sh"
else
  echo "[nodeaccess][dr] Doctor ignorado por RUN_DOCTOR=false."
fi

echo "[nodeaccess][dr] Harness de DR concluido com sucesso."
echo "- mysql_backup: $MYSQL_BACKUP"
echo "- session_audit_backup: $AUDIT_BACKUP"
echo "- user_avatar_backup: ${AVATAR_BACKUP:-ausente}"
echo "- backup_dir: $BACKUP_DIR"
