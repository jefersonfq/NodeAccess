#!/usr/bin/env bash
set -Eeuo pipefail

CONFIRM_RECONCILIATION="${CONFIRM_RECONCILIATION:-false}"
DATA_FINGERPRINT_MATCH="${DATA_FINGERPRINT_MATCH:-false}"
ERRANT_GTID_SET="${ERRANT_GTID_SET:-}"
ENV_FILE="${ENV_FILE:-/opt/nodeaccess/shared/.env}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-nodeaccess-state-mysql-1}"
REPORT_PATH="${REPORT_PATH:-/opt/nodeaccess/shared/ha/operations/gtid-reconciliation.json}"

fail() {
  echo "[fail] $*" >&2
  exit 1
}

[[ "$CONFIRM_RECONCILIATION" == "true" ]] ||
  fail "Reconciliação recusada. Use CONFIRM_RECONCILIATION=true."
[[ "$DATA_FINGERPRINT_MATCH" == "true" ]] ||
  fail "Reconciliação recusada sem confirmação de fingerprints idênticos."
[[ "$ERRANT_GTID_SET" =~ ^[0-9a-fA-F-]{36}:[1-9][0-9]*-[1-9][0-9]*$ ]] ||
  fail "ERRANT_GTID_SET deve conter um UUID e um intervalo contínuo."
[[ -f "$ENV_FILE" ]] || fail "Arquivo de ambiente ausente: $ENV_FILE"

uuid="${ERRANT_GTID_SET%%:*}"
interval="${ERRANT_GTID_SET##*:}"
start="${interval%-*}"
end="${interval#*-}"
((start <= end)) || fail "Intervalo GTID inválido."

db_root_password="$(
  awk -F= '$1 == "DB_ROOT_PASSWORD" { print substr($0, index($0, "=") + 1); exit }' \
    "$ENV_FILE"
)"
[[ -n "$db_root_password" ]] || fail "DB_ROOT_PASSWORD ausente."

mysql_exec() {
  docker exec -e MYSQL_PWD="$db_root_password" "$MYSQL_CONTAINER" \
    mysql -uroot --batch --skip-column-names -e "$1"
}

missing_before="$(mysql_exec \
  "SELECT GTID_SUBTRACT('$ERRANT_GTID_SET', @@GLOBAL.gtid_executed);")"
[[ "$missing_before" == "$ERRANT_GTID_SET" ]] ||
  fail "O conjunto já foi aplicado total ou parcialmente; operação recusada: ${missing_before:-none}"

for ((sequence = start; sequence <= end; sequence++)); do
  mysql_exec "
    SET GTID_NEXT='${uuid}:${sequence}';
    BEGIN;
    COMMIT;
    SET GTID_NEXT='AUTOMATIC';
  "
done

missing_after="$(mysql_exec \
  "SELECT GTID_SUBTRACT('$ERRANT_GTID_SET', @@GLOBAL.gtid_executed);")"
[[ -z "$missing_after" ]] ||
  fail "Reconciliação incompleta; GTIDs ainda ausentes: $missing_after"

mkdir -p "$(dirname "$REPORT_PATH")"
cat > "$REPORT_PATH" <<EOF
{
  "contract": "nodeaccess-ha-empty-gtid-reconciliation-v1",
  "status": "completed",
  "gtidSet": "$ERRANT_GTID_SET",
  "dataFingerprintMatchConfirmed": true,
  "transactionsCreated": $((end - start + 1)),
  "completedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chmod 0600 "$REPORT_PATH"

echo "[ok] GTIDs reconciliados com transações vazias."
echo "- gtid_set: $ERRANT_GTID_SET"
echo "- report: $REPORT_PATH"
