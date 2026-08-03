#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

BACKUP_DIR="${TMP_ROOT}/backups"
OK_SCRIPT="${TMP_ROOT}/ok.sh"
FAIL_SCRIPT="${TMP_ROOT}/fail.sh"

mkdir -p "$BACKUP_DIR"

cat > "$OK_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "[fake] ok"
EOF

cat > "$FAIL_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "[fake] fail" >&2
exit 19
EOF

chmod +x "$OK_SCRIPT" "$FAIL_SCRIPT"

DOCTOR_SCRIPT="$OK_SCRIPT" \
  HA_STATE_READINESS_SCRIPT="$OK_SCRIPT" \
  DR_ARTIFACT_CHECK_SCRIPT="$OK_SCRIPT" \
  DR_VALIDATION_HARNESS="$OK_SCRIPT" \
  BACKUP_DIR="$BACKUP_DIR" \
  REQUIRE_DOCKER_ACCESS=false \
  RUN_ENDPOINT_GATES=false \
  RUN_ISOLATED_RESTORE_CHECKS=true \
  bash "${PROJECT_ROOT}/scripts/deploy/standby-readiness.sh"

DOCTOR_SCRIPT="$OK_SCRIPT" \
  HA_STATE_READINESS_SCRIPT="$OK_SCRIPT" \
  DR_ARTIFACT_CHECK_SCRIPT="$OK_SCRIPT" \
  BACKUP_DIR="$BACKUP_DIR" \
  REQUIRE_DOCKER_ACCESS=false \
  RUN_ENDPOINT_GATES=false \
  RUN_ISOLATED_RESTORE_CHECKS=false \
  bash "${PROJECT_ROOT}/scripts/deploy/standby-readiness.sh"

set +e
DOCTOR_SCRIPT="$OK_SCRIPT" \
  HA_STATE_READINESS_SCRIPT="$FAIL_SCRIPT" \
  DR_ARTIFACT_CHECK_SCRIPT="$OK_SCRIPT" \
  BACKUP_DIR="$BACKUP_DIR" \
  REQUIRE_DOCKER_ACCESS=false \
  RUN_ENDPOINT_GATES=false \
  RUN_ISOLATED_RESTORE_CHECKS=false \
  bash "${PROJECT_ROOT}/scripts/deploy/standby-readiness.sh" >/dev/null 2>&1
failed_exit=$?
set -e

if [[ "$failed_exit" -eq 0 ]]; then
  echo "Readiness deveria falhar quando um check obrigatorio falha." >&2
  exit 1
fi

echo "[nodeaccess] Harness de standby readiness passou."
