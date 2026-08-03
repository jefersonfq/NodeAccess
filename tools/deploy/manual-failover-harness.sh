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
exit 23
EOF

chmod +x "$OK_SCRIPT" "$FAIL_SCRIPT"

BACKUP_ALL_SCRIPT="$OK_SCRIPT" \
  STANDBY_READINESS_SCRIPT="$OK_SCRIPT" \
  BACKUP_DIR="$BACKUP_DIR" \
  RUN_BACKUP_AGGREGATE=true \
  RUN_ISOLATED_RESTORE_CHECKS=true \
  bash "${PROJECT_ROOT}/scripts/deploy/pre-failover-check.sh"

DOCTOR_SCRIPT="$OK_SCRIPT" \
  BACKUP_DIR="$BACKUP_DIR" \
  RUN_ENDPOINT_GATES=false \
  bash "${PROJECT_ROOT}/scripts/deploy/post-failover-check.sh"

set +e
BACKUP_ALL_SCRIPT="$OK_SCRIPT" \
  STANDBY_READINESS_SCRIPT="$FAIL_SCRIPT" \
  BACKUP_DIR="$BACKUP_DIR" \
  RUN_BACKUP_AGGREGATE=false \
  bash "${PROJECT_ROOT}/scripts/deploy/pre-failover-check.sh" >/dev/null 2>&1
pre_failed_exit=$?
set -e

if [[ "$pre_failed_exit" -eq 0 ]]; then
  echo "Pre-failover deveria falhar quando standby readiness falha." >&2
  exit 1
fi

set +e
DOCTOR_SCRIPT="$OK_SCRIPT" \
  BACKUP_DIR="$BACKUP_DIR" \
  RUN_ENDPOINT_GATES=true \
  API_HEALTH_URL=http://127.0.0.1:1/health/ready \
  API_DEEP_HEALTH_URL=http://127.0.0.1:1/health/deep \
  GATEWAY_HEALTH_URL=http://127.0.0.1:1/health/ready \
  GATEWAY_DEEP_HEALTH_URL=http://127.0.0.1:1/health/deep \
  bash "${PROJECT_ROOT}/scripts/deploy/post-failover-check.sh" >/dev/null 2>&1
post_failed_exit=$?
set -e

if [[ "$post_failed_exit" -eq 0 ]]; then
  echo "Post-failover deveria falhar quando endpoints obrigatorios falham." >&2
  exit 1
fi

echo "[nodeaccess] Harness de failover manual passou."
