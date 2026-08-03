#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAN_SCRIPT="$PROJECT_ROOT/scripts/deploy/plan-ha-promotion.sh"
ISSUE_SCRIPT="$PROJECT_ROOT/scripts/deploy/ha-witness-issue-evidence.sh"
VERIFY_SCRIPT="$PROJECT_ROOT/scripts/deploy/ha-witness-verify-evidence.sh"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

private_key="$TMP_ROOT/witness-private.pem"
public_key="$TMP_ROOT/witness-public.pem"
evidence_prefix="$TMP_ROOT/evidence"
planned_prefix="$TMP_ROOT/planned"
state_script="$TMP_ROOT/state.sh"
file_script="$TMP_ROOT/files.sh"
env_file="$TMP_ROOT/nodeaccess.env"
journal_dir="$TMP_ROOT/journal"
nonce_dir="$TMP_ROOT/nonces"

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$private_key" >/dev/null 2>&1
openssl pkey -in "$private_key" -pubout -out "$public_key" >/dev/null 2>&1
CONFIRM_PRIMARY_FENCED=true \
PRIVATE_KEY="$private_key" \
PRIMARY_NODE_ID=node-b \
STANDBY_NODE_ID=node-a \
OUTPUT_PREFIX="$evidence_prefix" \
  bash "$ISSUE_SCRIPT" >/dev/null
EVIDENCE_MODE=planned \
CONFIRM_PLANNED_SWITCHOVER=true \
PRIVATE_KEY="$private_key" \
PRIMARY_NODE_ID=node-b \
STANDBY_NODE_ID=node-a \
OUTPUT_PREFIX="$planned_prefix" \
  bash "$ISSUE_SCRIPT" >/dev/null
grep -Fq 'contract=nodeaccess-ha-planned-switchover-v1' "${planned_prefix}.txt"
EVIDENCE_FILE="${planned_prefix}.txt" \
SIGNATURE_FILE="${planned_prefix}.sig" \
PUBLIC_KEY="$public_key" \
EXPECTED_PRIMARY_NODE_ID=node-b \
EXPECTED_STANDBY_NODE_ID=node-a \
  bash "$VERIFY_SCRIPT" >/dev/null

printf 'DB_ROOT_PASSWORD=harness\n' > "$env_file"
cat > "$state_script" <<'EOF'
#!/usr/bin/env bash
[[ "${FAIL_COMPONENT:-}" != "${CHECK_COMPONENT:-}" ]]
EOF
cat > "$file_script" <<'EOF'
#!/usr/bin/env bash
[[ "${FAIL_FILES:-false}" != true ]]
EOF
chmod +x "$state_script" "$file_script"

echo "[nodeaccess] Cenario 1/3: plano somente leitura aprovado..."
OPERATION_ID=promotion-harness-ready \
PRIMARY_NODE_ID=node-b \
STANDBY_NODE_ID=node-a \
VIRTUAL_IP=192.0.2.254 \
WITNESS_EVIDENCE_FILE="${evidence_prefix}.txt" \
WITNESS_SIGNATURE_FILE="${evidence_prefix}.sig" \
WITNESS_PUBLIC_KEY="$public_key" \
WITNESS_VERIFY_SCRIPT="$VERIFY_SCRIPT" \
STATE_STATUS_SCRIPT="$state_script" \
FILE_STATUS_SCRIPT="$file_script" \
ENV_FILE="$env_file" \
JOURNAL_DIR="$journal_dir" \
REPLICA_ROOT="$TMP_ROOT/replica" \
  bash "$PLAN_SCRIPT" >/dev/null
grep -Fq '"status": "ready"' "$journal_dir/promotion-harness-ready.plan.json"
grep -Fq '"mutationsExecuted": false' "$journal_dir/promotion-harness-ready.plan.json"

echo "[nodeaccess] Cenario 2/3: gate degradado bloqueia plano..."
if FAIL_COMPONENT=mysql \
  OPERATION_ID=promotion-harness-blocked \
  PRIMARY_NODE_ID=node-b \
  STANDBY_NODE_ID=node-a \
  VIRTUAL_IP=192.0.2.254 \
  WITNESS_EVIDENCE_FILE="${evidence_prefix}.txt" \
  WITNESS_SIGNATURE_FILE="${evidence_prefix}.sig" \
  WITNESS_PUBLIC_KEY="$public_key" \
  WITNESS_VERIFY_SCRIPT="$VERIFY_SCRIPT" \
  STATE_STATUS_SCRIPT="$state_script" \
  FILE_STATUS_SCRIPT="$file_script" \
  ENV_FILE="$env_file" \
  JOURNAL_DIR="$journal_dir" \
  REPLICA_ROOT="$TMP_ROOT/replica" \
    bash "$PLAN_SCRIPT" >/dev/null 2>&1; then
  echo "[fail] Plano degradado foi aprovado indevidamente." >&2
  exit 1
fi
grep -Fq '"mysql": "failed"' "$journal_dir/promotion-harness-blocked.plan.json"

echo "[nodeaccess] Cenario 3/3: nonce consumido nao pode ser reutilizado..."
EVIDENCE_FILE="${evidence_prefix}.txt" \
SIGNATURE_FILE="${evidence_prefix}.sig" \
PUBLIC_KEY="$public_key" \
EXPECTED_PRIMARY_NODE_ID=node-b \
EXPECTED_STANDBY_NODE_ID=node-a \
CONSUME_NONCE=true \
NONCE_STORE_DIR="$nonce_dir" \
  bash "$VERIFY_SCRIPT" >/dev/null
if EVIDENCE_FILE="${evidence_prefix}.txt" \
  SIGNATURE_FILE="${evidence_prefix}.sig" \
  PUBLIC_KEY="$public_key" \
  EXPECTED_PRIMARY_NODE_ID=node-b \
  EXPECTED_STANDBY_NODE_ID=node-a \
  CONSUME_NONCE=true \
  NONCE_STORE_DIR="$nonce_dir" \
    bash "$VERIFY_SCRIPT" >/dev/null 2>&1; then
  echo "[fail] Replay da evidencia foi aceito indevidamente." >&2
  exit 1
fi

echo "[ok] Harness do plano de promocao HA passou."
