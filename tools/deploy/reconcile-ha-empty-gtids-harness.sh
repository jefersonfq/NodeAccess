#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_SCRIPT="$PROJECT_ROOT/scripts/deploy/reconcile-ha-empty-gtids.sh"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/bin"
cat > "$TMP_ROOT/env" <<'EOF'
DB_ROOT_PASSWORD=harness
EOF
cat > "$TMP_ROOT/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_LOG:?}"
if [[ "$*" == *"GTID_SUBTRACT("* ]]; then
  count=0
  [[ ! -f "${FAKE_COUNT:?}" ]] || count="$(cat "$FAKE_COUNT")"
  count=$((count + 1))
  printf '%s\n' "$count" > "$FAKE_COUNT"
  if ((count > 1)); then
    exit 0
  fi
  printf '%s\n' "${EXPECTED_GTID:?}"
fi
EOF
chmod +x "$TMP_ROOT/bin/docker"

gtid="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:1-3"
common=(
  "PATH=$TMP_ROOT/bin:$PATH"
  "ENV_FILE=$TMP_ROOT/env"
  "REPORT_PATH=$TMP_ROOT/report.json"
  "FAKE_LOG=$TMP_ROOT/docker.log"
  "FAKE_COUNT=$TMP_ROOT/docker-count"
  "EXPECTED_GTID=$gtid"
  "ERRANT_GTID_SET=$gtid"
)

echo "[nodeaccess] Cenário 1/3: confirmação ausente bloqueia..."
if env "${common[@]}" DATA_FINGERPRINT_MATCH=true bash "$TARGET_SCRIPT" >/dev/null 2>&1; then
  echo "[fail] Reconciliação sem confirmação deveria falhar." >&2
  exit 1
fi

echo "[nodeaccess] Cenário 2/3: fingerprint divergente bloqueia..."
if env "${common[@]}" CONFIRM_RECONCILIATION=true bash "$TARGET_SCRIPT" >/dev/null 2>&1; then
  echo "[fail] Reconciliação sem fingerprint idêntico deveria falhar." >&2
  exit 1
fi

echo "[nodeaccess] Cenário 3/3: intervalo gera somente transações vazias..."
: > "$TMP_ROOT/docker.log"
rm -f "$TMP_ROOT/docker-count"
env "${common[@]}" CONFIRM_RECONCILIATION=true \
  DATA_FINGERPRINT_MATCH=true bash "$TARGET_SCRIPT"
[[ "$(grep -c "SET GTID_NEXT='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:" \
  "$TMP_ROOT/docker.log")" -eq 3 ]]
grep -q '"transactionsCreated": 3' "$TMP_ROOT/report.json"

echo "[ok] Harness de reconciliação de GTID vazio passou."
