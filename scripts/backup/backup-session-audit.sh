#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"
OUTPUT_DIR="${1:-./backups}"
SESSION_AUDIT_SOURCE_DIR="${SESSION_AUDIT_SOURCE_DIR:-}"
SESSION_AUDIT_VOLUME_NAME="${SESSION_AUDIT_VOLUME_NAME:-${COMPOSE_PROJECT_NAME}_session_audit_data}"
BACKUP_HELPER_IMAGE="${BACKUP_HELPER_IMAGE:-mysql:8.0}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de ambiente nao encontrado: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_LOADER_SCRIPT" ]]; then
  echo "Carregador de ambiente nao encontrado: $ENV_LOADER_SCRIPT" >&2
  exit 1
fi

source "$ENV_LOADER_SCRIPT"
load_env_file "$ENV_FILE"
SESSION_AUDIT_SOURCE_DIR="${SESSION_AUDIT_SOURCE_DIR:-${SESSION_AUDIT_HOST_DIR:-}}"

if ! command -v tar >/dev/null 2>&1; then
  echo "tar nao encontrado no PATH" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker nao encontrado no PATH" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

APP_VERSION="unknown"
if [[ -f "${PROJECT_ROOT}/package.json" ]]; then
  APP_VERSION="$(grep -m1 '"version"' "${PROJECT_ROOT}/package.json" | sed -E 's/.*"version": "([^"]+)".*/\1/')"
elif [[ -f "${PROJECT_ROOT}/VERSION" ]]; then
  APP_VERSION="$(head -n 1 "${PROJECT_ROOT}/VERSION" | tr -d '\r')"
fi

HOSTNAME_VALUE="$(hostname 2>/dev/null || echo unknown-host)"
BASE_NAME="nodeaccess-session-audit-${TIMESTAMP}"
ARCHIVE_PATH="${OUTPUT_DIR}/${BASE_NAME}.tar.gz"
MANIFEST_PATH="${OUTPUT_DIR}/${BASE_NAME}.manifest.json"
CHECKSUM_PATH="${OUTPUT_DIR}/${BASE_NAME}.sha256"
SOURCE_KIND="docker-volume"
SOURCE_REF="$SESSION_AUDIT_VOLUME_NAME"

count_archive_entries() {
  tar -tzf "$ARCHIVE_PATH" 2>/dev/null | awk '$0 != "." && $0 != "./" { count++ } END { print count + 0 }'
}

if [[ -n "$SESSION_AUDIT_SOURCE_DIR" ]]; then
  if [[ ! -d "$SESSION_AUDIT_SOURCE_DIR" ]]; then
    echo "Diretorio de auditoria nao encontrado: $SESSION_AUDIT_SOURCE_DIR" >&2
    exit 1
  fi

  SOURCE_KIND="directory"
  SOURCE_REF="$SESSION_AUDIT_SOURCE_DIR"
  echo "[nodeaccess] Gerando backup de auditoria SSH a partir do diretorio: $SESSION_AUDIT_SOURCE_DIR"
  tar -C "$SESSION_AUDIT_SOURCE_DIR" -czf "$ARCHIVE_PATH" .
else
  if ! docker volume inspect "$SESSION_AUDIT_VOLUME_NAME" >/dev/null 2>&1; then
    echo "Volume de auditoria nao encontrado: $SESSION_AUDIT_VOLUME_NAME" >&2
    echo "Informe SESSION_AUDIT_SOURCE_DIR para backup a partir de diretorio local." >&2
    exit 1
  fi

  echo "[nodeaccess] Gerando backup de auditoria SSH a partir do volume: $SESSION_AUDIT_VOLUME_NAME"
  docker run --rm \
    -e ARCHIVE_NAME="$(basename "$ARCHIVE_PATH")" \
    -v "${SESSION_AUDIT_VOLUME_NAME}:/nodeaccess-session-audit:ro" \
    -v "${OUTPUT_DIR}:/nodeaccess-backups" \
    "$BACKUP_HELPER_IMAGE" \
    sh -lc 'cd /nodeaccess-session-audit && tar -czf "/nodeaccess-backups/${ARCHIVE_NAME}" .'
fi

if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM_VALUE="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  CHECKSUM_VALUE="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
else
  echo "Nenhum utilitario de checksum encontrado (sha256sum/shasum)" >&2
  exit 1
fi

printf '%s  %s\n' "$CHECKSUM_VALUE" "$(basename "$ARCHIVE_PATH")" > "$CHECKSUM_PATH"
ENTRY_COUNT="$(count_archive_entries)"

cat > "$MANIFEST_PATH" <<EOF
{
  "type": "nodeaccess-session-audit-backup",
  "createdAt": "$(date -Iseconds)",
  "appVersion": "${APP_VERSION:-unknown}",
  "sourceHost": "${HOSTNAME_VALUE}",
  "sourceKind": "${SOURCE_KIND}",
  "sourceRef": "${SOURCE_REF}",
  "archiveFile": "$(basename "$ARCHIVE_PATH")",
  "sha256": "$CHECKSUM_VALUE",
  "entryCount": ${ENTRY_COUNT:-0},
  "notes": [
    "This backup contains SSH session audit chunks only.",
    "Keep it protected because chunks may contain terminal output and sensitive operational data."
  ]
}
EOF

echo "[nodeaccess] Backup de auditoria SSH concluido."
echo "- archive: $ARCHIVE_PATH"
echo "- manifest: $MANIFEST_PATH"
echo "- checksum: $CHECKSUM_PATH"
echo "- entries: ${ENTRY_COUNT:-0}"
