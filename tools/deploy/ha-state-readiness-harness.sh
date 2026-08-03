#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TARGET_SCRIPT="${PROJECT_ROOT}/scripts/deploy/ha-state-readiness.sh"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p \
  "${WORK_DIR}/audit" \
  "${WORK_DIR}/avatars" \
  "${WORK_DIR}/backups"

cat >"${WORK_DIR}/.env" <<'ENV'
DATABASE_URL=mysql://nodeaccess:nodeaccess@mysql:3306/nodeaccess
REDIS_URL=redis://redis:6379
JWT_SECRET=test-secret-with-at-least-thirty-two-chars
PEM_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
ENV

touch "${WORK_DIR}/backups/nodeaccess-mysql-harness.manifest.json"
touch "${WORK_DIR}/backups/nodeaccess-session-audit-harness.manifest.json"
touch "${WORK_DIR}/backups/nodeaccess-user-avatars-harness.manifest.json"

OUTPUT="$(
  ENV_FILE="${WORK_DIR}/.env" \
  BACKUP_DIR="${WORK_DIR}/backups" \
  SESSION_AUDIT_STORAGE_DIR="${WORK_DIR}/audit" \
  USER_AVATAR_STORAGE_DIR="${WORK_DIR}/avatars" \
  HA_READINESS_OUTPUT=json \
  bash "$TARGET_SCRIPT"
)"

node -e "
const payload = JSON.parse(process.argv[1])
if (payload.status !== 'ok') throw new Error('status esperado ok, recebido ' + payload.status)
if (payload.failures !== 0) throw new Error('failures esperado 0')
if (payload.warnings !== 0) throw new Error('warnings esperado 0')
const messages = payload.checks.map((check) => check.message)
for (const expected of [
  'Storage de auditoria SSH permite escrita/leitura',
  'Storage de avatares de usuario permite escrita/leitura',
  'Backup MySQL recente',
  'Backup de auditoria SSH recente',
  'Backup de avatares de usuario recente',
]) {
  if (!messages.some((message) => message.includes(expected))) {
    throw new Error('check ausente: ' + expected)
  }
}
" "$OUTPUT"

echo "[ok] ha-state-readiness harness passou"
