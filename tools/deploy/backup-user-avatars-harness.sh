#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p \
  "${WORK_DIR}/source/tenant-a" \
  "${WORK_DIR}/restore" \
  "${WORK_DIR}/backups"

cat >"${WORK_DIR}/.env" <<'ENV'
DATABASE_URL=mysql://nodeaccess:nodeaccess@mysql:3306/nodeaccess
REDIS_URL=redis://redis:6379
JWT_SECRET=test-secret-with-at-least-thirty-two-chars
PEM_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
ENV

printf 'avatar-bytes\n' > "${WORK_DIR}/source/tenant-a/1.avatar"

ENV_FILE="${WORK_DIR}/.env" \
USER_AVATAR_SOURCE_DIR="${WORK_DIR}/source" \
bash "${PROJECT_ROOT}/scripts/backup/backup-user-avatars.sh" "${WORK_DIR}/backups" >/tmp/nodeaccess-avatar-backup-harness.out

ARCHIVE="$(find "${WORK_DIR}/backups" -type f -name 'nodeaccess-user-avatars-*.tar.gz' -print -quit)"
MANIFEST="${ARCHIVE%.tar.gz}.manifest.json"
CHECKSUM="${ARCHIVE%.tar.gz}.sha256"

[[ -f "$ARCHIVE" ]] || { echo "[fail] archive ausente" >&2; exit 1; }
[[ -f "$MANIFEST" ]] || { echo "[fail] manifest ausente" >&2; exit 1; }
[[ -f "$CHECKSUM" ]] || { echo "[fail] checksum ausente" >&2; exit 1; }

ENV_FILE="${WORK_DIR}/.env" \
USER_AVATAR_RESTORE_TARGET_DIR="${WORK_DIR}/restore" \
bash "${PROJECT_ROOT}/scripts/backup/restore-user-avatars.sh" "$ARCHIVE" --yes >/tmp/nodeaccess-avatar-restore-harness.out

cmp "${WORK_DIR}/source/tenant-a/1.avatar" "${WORK_DIR}/restore/tenant-a/1.avatar"

echo "[ok] backup-user-avatars harness passou"
