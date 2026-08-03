#!/usr/bin/env bash
set -Eeuo pipefail

OPERATION_ID="${OPERATION_ID:-}"
PRIMARY_NODE_ID="${PRIMARY_NODE_ID:-}"
STANDBY_NODE_ID="${STANDBY_NODE_ID:-}"
VIRTUAL_IP="${VIRTUAL_IP:-192.168.1.105}"
WITNESS_EVIDENCE_FILE="${WITNESS_EVIDENCE_FILE:-}"
WITNESS_SIGNATURE_FILE="${WITNESS_SIGNATURE_FILE:-${WITNESS_EVIDENCE_FILE}.sig}"
WITNESS_PUBLIC_KEY="${WITNESS_PUBLIC_KEY:-/opt/nodeaccess/shared/ha/witness-public.pem}"
WITNESS_VERIFY_SCRIPT="${WITNESS_VERIFY_SCRIPT:-/opt/nodeaccess/current/scripts/deploy/ha-witness-verify-evidence.sh}"
STATE_STATUS_SCRIPT="${STATE_STATUS_SCRIPT:-/opt/nodeaccess/current/scripts/deploy/ha-state-replication-status.sh}"
FILE_STATUS_SCRIPT="${FILE_STATUS_SCRIPT:-/opt/nodeaccess/current/scripts/deploy/ha-file-replica-status.sh}"
ENV_FILE="${ENV_FILE:-/opt/nodeaccess/shared/.env}"
FILE_SYNC_ENV_FILE="${FILE_SYNC_ENV_FILE:-/etc/sysconfig/nodeaccess-ha-file-sync}"
if [[ -z "${REPLICA_ROOT:-}" && -f "$FILE_SYNC_ENV_FILE" ]]; then
  REPLICA_ROOT="$(
    awk -F= '$1 == "REPLICA_ROOT" { print substr($0, index($0, "=") + 1); exit }' \
      "$FILE_SYNC_ENV_FILE"
  )"
fi
REPLICA_ROOT="${REPLICA_ROOT:-/srv/nodeaccess-replica}"
JOURNAL_DIR="${JOURNAL_DIR:-/opt/nodeaccess/shared/ha/operations}"
REPORT_PATH="${REPORT_PATH:-${JOURNAL_DIR}/${OPERATION_ID}.plan.json}"
ALLOW_SOURCE_DOWN="${ALLOW_SOURCE_DOWN:-false}"

fail() {
  echo "[fail] $*" >&2
  exit 1
}

[[ "$OPERATION_ID" =~ ^[A-Za-z0-9._:-]{8,100}$ ]] ||
  fail "OPERATION_ID obrigatorio e invalido."
[[ "$PRIMARY_NODE_ID" =~ ^[A-Za-z0-9._:-]+$ ]] ||
  fail "PRIMARY_NODE_ID obrigatorio e invalido."
[[ "$STANDBY_NODE_ID" =~ ^[A-Za-z0-9._:-]+$ ]] ||
  fail "STANDBY_NODE_ID obrigatorio e invalido."
[[ "$PRIMARY_NODE_ID" != "$STANDBY_NODE_ID" ]] ||
  fail "Primario e standby devem ser diferentes."

for required_file in "$WITNESS_VERIFY_SCRIPT" "$STATE_STATUS_SCRIPT" "$FILE_STATUS_SCRIPT" "$ENV_FILE"; do
  [[ -f "$required_file" ]] || fail "Arquivo obrigatorio ausente: $required_file"
done

mkdir -p "$JOURNAL_DIR"
chmod 0700 "$JOURNAL_DIR"
tmp_report="${REPORT_PATH}.tmp"
trap 'rm -f "$tmp_report"' EXIT

witness=failed
mysql=failed
redis=failed
files=failed
vip=failed

if EVIDENCE_FILE="$WITNESS_EVIDENCE_FILE" \
  SIGNATURE_FILE="$WITNESS_SIGNATURE_FILE" \
  PUBLIC_KEY="$WITNESS_PUBLIC_KEY" \
  EXPECTED_PRIMARY_NODE_ID="$PRIMARY_NODE_ID" \
  EXPECTED_STANDBY_NODE_ID="$STANDBY_NODE_ID" \
  CONSUME_NONCE=false \
  bash "$WITNESS_VERIFY_SCRIPT" >/dev/null 2>&1; then
  witness=ok
fi
if ENV_FILE="$ENV_FILE" CHECK_COMPONENT=mysql ALLOW_SOURCE_DOWN="$ALLOW_SOURCE_DOWN" \
  bash "$STATE_STATUS_SCRIPT" >/dev/null 2>&1; then
  mysql=ok
fi
if ENV_FILE="$ENV_FILE" CHECK_COMPONENT=redis ALLOW_SOURCE_DOWN="$ALLOW_SOURCE_DOWN" \
  bash "$STATE_STATUS_SCRIPT" >/dev/null 2>&1; then
  redis=ok
fi
if REPLICA_ROOT="$REPLICA_ROOT" REQUIRE_SOURCE_MATCH=false bash "$FILE_STATUS_SCRIPT" >/dev/null 2>&1; then
  files=ok
fi
if ! ip -4 address show | grep -Fq "$VIRTUAL_IP/"; then
  vip=ok
fi

status=blocked
if [[ "$witness" == ok && "$mysql" == ok && "$redis" == ok && "$files" == ok && "$vip" == ok ]]; then
  status=ready
fi

cat > "$tmp_report" <<EOF
{
  "contract": "nodeaccess-ha-promotion-plan-v1",
  "operationId": "$OPERATION_ID",
  "status": "$status",
  "primaryNodeId": "$PRIMARY_NODE_ID",
  "standbyNodeId": "$STANDBY_NODE_ID",
  "virtualIp": "$VIRTUAL_IP",
  "checks": {
    "witness": "$witness",
    "mysql": "$mysql",
    "redis": "$redis",
    "files": "$files",
    "vipAbsentOnStandby": "$vip"
  },
  "mutationsExecuted": false,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chmod 0600 "$tmp_report"
mv -f "$tmp_report" "$REPORT_PATH"
trap - EXIT

if [[ "$status" != ready ]]; then
  echo "[fail] Plano de promocao bloqueado. Relatorio: $REPORT_PATH" >&2
  exit 1
fi

echo "[ok] Plano de promocao aprovado em modo somente leitura."
echo "- operation_id: $OPERATION_ID"
echo "- report: $REPORT_PATH"
echo "- mutations_executed: false"
