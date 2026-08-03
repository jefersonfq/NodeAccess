#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ARCHIVE_FILE="${1:-}"
RESTORE_VOLUME_NAME="${RESTORE_VOLUME_NAME:-nodeaccess_session_audit_restore_harness_$(date +%Y%m%d%H%M%S)}"
TMP_ROOT="${TMP_ROOT:-$(mktemp -d /tmp/nodeaccess-session-audit-restore.XXXXXX)}"
RESTORE_ENV_FILE="${TMP_ROOT}/.env"
KEEP_RESTORE_HARNESS="${KEEP_RESTORE_HARNESS:-false}"

if [[ -z "$ARCHIVE_FILE" ]]; then
  echo "Uso: bash tools/deploy/restore-session-audit-isolated-harness.sh <backup.tar.gz>" >&2
  exit 1
fi

if [[ "$ARCHIVE_FILE" != /* ]]; then
  ARCHIVE_FILE="$(cd "$(dirname "$ARCHIVE_FILE")" && pwd)/$(basename "$ARCHIVE_FILE")"
fi

if [[ ! -f "$ARCHIVE_FILE" ]]; then
  echo "Backup de auditoria nao encontrado: $ARCHIVE_FILE" >&2
  exit 1
fi

cleanup() {
  if [[ "$KEEP_RESTORE_HARNESS" == "true" ]]; then
    echo "[nodeaccess] Mantendo harness para inspecao."
    echo "- volume: $RESTORE_VOLUME_NAME"
    echo "- tmp_root: $TMP_ROOT"
    return
  fi

  docker volume rm "$RESTORE_VOLUME_NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || {
  echo "docker nao encontrado no PATH" >&2
  exit 1
}

mkdir -p "$TMP_ROOT"
cat > "$RESTORE_ENV_FILE" <<'EOF'
NODE_ENV=development
APP_URL=http://127.0.0.1
TLS_MODE=off
DATABASE_URL=mysql://nodeaccess:nodeaccess@mysql:3306/nodeaccess
REDIS_URL=redis://redis:6379
JWT_SECRET=12345678901234567890123456789012
PEM_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
DB_ROOT_PASSWORD=root-password
DB_NAME=nodeaccess
DB_USER=nodeaccess
DB_PASSWORD=nodeaccess
EOF

echo "[nodeaccess] Criando volume temporario para restore de auditoria SSH..."
docker volume create "$RESTORE_VOLUME_NAME" >/dev/null

SESSION_AUDIT_VOLUME_NAME="$RESTORE_VOLUME_NAME" \
ENV_FILE="$RESTORE_ENV_FILE" \
bash "$PROJECT_ROOT/scripts/backup/restore-session-audit.sh" "$ARCHIVE_FILE" --yes

RESTORED_COUNT="$(docker run --rm -v "${RESTORE_VOLUME_NAME}:/nodeaccess-session-audit:ro" mysql:8.0 \
  sh -lc 'find /nodeaccess-session-audit -mindepth 1 | wc -l | tr -d "[:space:]"')"

echo "[nodeaccess] Restore isolado de auditoria SSH validado com sucesso."
echo "- archive: $ARCHIVE_FILE"
echo "- volume: $RESTORE_VOLUME_NAME"
echo "- restored_entries: ${RESTORED_COUNT:-0}"
