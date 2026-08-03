#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

FAKE_ENV_FILE="${TMP_ROOT}/.env"
BACKUP_DIR="${TMP_ROOT}/backups"
MYSQL_SCRIPT="${TMP_ROOT}/backup-mysql.sh"
AUDIT_SCRIPT="${TMP_ROOT}/backup-session-audit.sh"
AVATAR_SCRIPT="${TMP_ROOT}/backup-user-avatars.sh"
FAIL_SCRIPT="${TMP_ROOT}/fail.sh"

cat > "$FAKE_ENV_FILE" <<EOF
DB_ROOT_PASSWORD=test
DB_NAME=nodeaccess
EOF

mkdir -p "$BACKUP_DIR"

cat > "$MYSQL_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "${1}/mysql.ok"
EOF

cat > "$AUDIT_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "${1}/audit.ok"
EOF

cat > "$AVATAR_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "${1}/avatar.ok"
EOF

cat > "$FAIL_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "falha simulada" >&2
exit 17
EOF

chmod +x "$MYSQL_SCRIPT" "$AUDIT_SCRIPT" "$AVATAR_SCRIPT" "$FAIL_SCRIPT"

ENV_FILE="$FAKE_ENV_FILE" \
  MYSQL_BACKUP_SCRIPT="$MYSQL_SCRIPT" \
  SESSION_AUDIT_BACKUP_SCRIPT="$AUDIT_SCRIPT" \
  USER_AVATAR_BACKUP_SCRIPT="$AVATAR_SCRIPT" \
  RUN_DR_ARTIFACT_CHECK=false \
  bash "${PROJECT_ROOT}/scripts/backup/backup-all-nodeaccess.sh" "$BACKUP_DIR"

for marker in mysql.ok audit.ok avatar.ok; do
  if [[ ! -f "${BACKUP_DIR}/${marker}" ]]; then
    echo "Marcador esperado nao encontrado: $marker" >&2
    exit 1
  fi
done

rm -f "${BACKUP_DIR}/audit.ok"
ENV_FILE="$FAKE_ENV_FILE" \
  MYSQL_BACKUP_SCRIPT="$MYSQL_SCRIPT" \
  SESSION_AUDIT_BACKUP_SCRIPT="$FAIL_SCRIPT" \
  USER_AVATAR_BACKUP_SCRIPT="$AVATAR_SCRIPT" \
  RUN_DR_ARTIFACT_CHECK=false \
  REQUIRE_STATEFUL_BACKUPS=false \
  bash "${PROJECT_ROOT}/scripts/backup/backup-all-nodeaccess.sh" "$BACKUP_DIR"

if [[ -f "${BACKUP_DIR}/audit.ok" ]]; then
  echo "Backup stateful tolerante nao deveria ter criado audit.ok" >&2
  exit 1
fi

set +e
ENV_FILE="$FAKE_ENV_FILE" \
  MYSQL_BACKUP_SCRIPT="$MYSQL_SCRIPT" \
  SESSION_AUDIT_BACKUP_SCRIPT="$FAIL_SCRIPT" \
  USER_AVATAR_BACKUP_SCRIPT="$AVATAR_SCRIPT" \
  RUN_DR_ARTIFACT_CHECK=false \
  REQUIRE_STATEFUL_BACKUPS=true \
  bash "${PROJECT_ROOT}/scripts/backup/backup-all-nodeaccess.sh" "$BACKUP_DIR" >/dev/null 2>&1
strict_exit=$?
set -e

if [[ "$strict_exit" -eq 0 ]]; then
  echo "Backup stateful estrito deveria falhar." >&2
  exit 1
fi

echo "[nodeaccess] Harness de backup agregado passou."
