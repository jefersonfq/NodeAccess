#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${MODE:-status}"
CONFIRM_QUIESCE="${CONFIRM_QUIESCE:-false}"
ENV_FILE="${ENV_FILE:-/opt/nodeaccess/shared/.env}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-nodeaccess-state-mysql-1}"
VIRTUAL_IP="${VIRTUAL_IP:-192.168.1.105}"
JOURNAL_DIR="${JOURNAL_DIR:-/opt/nodeaccess/shared/ha/operations}"
OPERATION_ID="${OPERATION_ID:-}"
MARKER_FILE="${MARKER_FILE:-/opt/nodeaccess/shared/ha/primary-quiesced}"
KEEPALIVED_SERVICE="${KEEPALIVED_SERVICE:-keepalived}"

fail() {
  echo "[fail] $*" >&2
  exit 1
}

[[ "$MODE" == "status" || "$MODE" == "apply" || "$MODE" == "rollback" ]] ||
  fail "MODE deve ser status, apply ou rollback."
[[ "$OPERATION_ID" =~ ^[A-Za-z0-9._:-]{8,100}$ ]] ||
  fail "OPERATION_ID obrigatório e inválido."
[[ -f "$ENV_FILE" ]] || fail "Arquivo de ambiente ausente: $ENV_FILE"

db_root_password="$(
  awk -F= '$1 == "DB_ROOT_PASSWORD" { print substr($0, index($0, "=") + 1); exit }' \
    "$ENV_FILE"
)"
[[ -n "$db_root_password" ]] || fail "DB_ROOT_PASSWORD ausente."

mkdir -p "$JOURNAL_DIR"
chmod 0700 "$JOURNAL_DIR"
journal_file="${JOURNAL_DIR}/${OPERATION_ID}.source.jsonl"
touch "$journal_file"
chmod 0600 "$journal_file"

checkpoint() {
  printf '{"contract":"nodeaccess-ha-source-quiesce-v1","operationId":"%s","stage":"%s","status":"%s","observedAt":"%s"}\n' \
    "$OPERATION_ID" "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$journal_file"
}

mysql_exec() {
  docker exec -e MYSQL_PWD="$db_root_password" "$MYSQL_CONTAINER" \
    mysql -uroot --batch --skip-column-names -e "$1"
}

owns_vip() {
  ip -4 address show | grep -Fq "$VIRTUAL_IP/"
}

if [[ "$MODE" == "status" ]]; then
  read_only_state="$(mysql_exec "SELECT @@GLOBAL.read_only, @@GLOBAL.super_read_only;")"
  echo "[ok] Estado da origem consultado."
  echo "- owns_vip: $(owns_vip && echo true || echo false)"
  echo "- mysql_read_only: $read_only_state"
  echo "- marker: $([[ -f "$MARKER_FILE" ]] && echo present || echo absent)"
  exit 0
fi

if [[ "$MODE" == "rollback" ]]; then
  checkpoint rollback running
  mysql_exec "SET GLOBAL super_read_only=OFF; SET GLOBAL read_only=OFF;"
  systemctl start "$KEEPALIVED_SERVICE"
  rm -f "$MARKER_FILE"
  checkpoint rollback completed
  echo "[ok] Origem devolvida ao modo gravável; Keepalived iniciado."
  exit 0
fi

[[ "$CONFIRM_QUIESCE" == "true" ]] ||
  fail "Quiesce recusado. Use CONFIRM_QUIESCE=true."
owns_vip || fail "Este nó não possui a VIP $VIRTUAL_IP."
[[ ! -f "$MARKER_FILE" ]] || fail "Origem já está marcada como quiesced."

rollback_on_error() {
  exit_code="$?"
  checkpoint automatic-rollback running
  mysql_exec "SET GLOBAL super_read_only=OFF; SET GLOBAL read_only=OFF;" || true
  systemctl start "$KEEPALIVED_SERVICE" || true
  rm -f "$MARKER_FILE"
  checkpoint automatic-rollback completed
  exit "$exit_code"
}
trap rollback_on_error ERR

checkpoint mysql-freeze running
mysql_exec "SET GLOBAL read_only=ON; SET GLOBAL super_read_only=ON;"
checkpoint mysql-freeze completed

checkpoint vip-release running
systemctl stop "$KEEPALIVED_SERVICE"
if owns_vip; then
  fail "VIP permaneceu no nó após parada do Keepalived."
fi
checkpoint vip-release completed

mkdir -p "$(dirname "$MARKER_FILE")"
printf 'operation_id=%s\nquiesced_at=%s\n' \
  "$OPERATION_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER_FILE"
chmod 0600 "$MARKER_FILE"
checkpoint quiesced completed
trap - ERR

echo "[ok] Primário congelado e sem VIP."
echo "- journal: $journal_file"
echo "- marker: $MARKER_FILE"
echo "- rollback: MODE=rollback OPERATION_ID=$OPERATION_ID bash $0"
