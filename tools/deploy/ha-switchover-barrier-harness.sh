#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$ROOT/scripts/deploy/promote-ha-standby.sh"
PROMOTED_CONFIG="$ROOT/docker/mysql/ha/promoted.cnf"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

grep -Eq '^[[:space:]]*read_only[[:space:]]*=[[:space:]]*OFF' "$PROMOTED_CONFIG"
grep -Eq '^[[:space:]]*super_read_only[[:space:]]*=[[:space:]]*OFF' "$PROMOTED_CONFIG"
if grep -Eq '^[[:space:]]*server-id[[:space:]]*=' "$PROMOTED_CONFIG"; then
  echo "[fail] Perfil promovido não pode sobrescrever o server-id único do nó." >&2
  exit 1
fi

cat > "$TMP/final-sync.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'final-sync %s\n' "${ACTIVE_NODE_IP:-}" >> "${HARNESS_LOG:?}"
[[ "${REPORT_PATH:-}" != *".source-fencing.json" ]] || exit 0
[[ "${FAIL_FINAL_SYNC:-false}" != "true" ]]
EOF
cat > "$TMP/plan.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'plan\n' >> "${HARNESS_LOG:?}"
EOF
cat > "$TMP/witness.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'witness\n' >> "${HARNESS_LOG:?}"
exit 1
EOF
chmod +x "$TMP/"*.sh
mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
exit 7
EOF
chmod +x "$TMP/bin/curl"

common=(
  "CONFIRM_PROMOTION=true"
  "OPERATION_ID=switchover-barrier-harness"
  "PRIMARY_NODE_ID=node-b"
  "STANDBY_NODE_ID=node-a"
  "FINAL_SYNC_SOURCE_IP=192.0.2.20"
  "FINAL_SYNC_SCRIPT=$TMP/final-sync.sh"
  "PLAN_SCRIPT=$TMP/plan.sh"
  "WITNESS_VERIFY_SCRIPT=$TMP/witness.sh"
  "MYSQL_VOLUME_NAME=harness-mysql"
  "REDIS_VOLUME_NAME=harness-redis"
  "MYSQL_PROMOTED_CONFIG=$TMP/promoted.cnf"
  "JOURNAL_DIR=$TMP/journal"
  "HARNESS_LOG=$TMP/actions.log"
  "PATH=$TMP/bin:$PATH"
)

echo "[nodeaccess] Cenário 1/2: GTID pendente bloqueia antes do plano e witness..."
: > "$TMP/actions.log"
if env "${common[@]}" FAIL_FINAL_SYNC=true bash "$TARGET" >/dev/null 2>&1; then
  exit 1
fi
grep -q '^final-sync 192.0.2.20$' "$TMP/actions.log"
if grep -Eq '^(plan|witness)$' "$TMP/actions.log"; then
  echo "[fail] Promoção avançou após falha na barreira final." >&2
  exit 1
fi

echo "[nodeaccess] Cenário 2/2: paridade libera plano, mas witness ainda bloqueia..."
: > "$TMP/actions.log"
if env "${common[@]}" FAIL_FINAL_SYNC=false bash "$TARGET" >/dev/null 2>&1; then
  exit 1
fi
grep -q '^final-sync 192.0.2.20$' "$TMP/actions.log"
grep -q '^plan$' "$TMP/actions.log"
grep -q '^witness$' "$TMP/actions.log"

echo "[ok] Harness da barreira final de switchover passou."
