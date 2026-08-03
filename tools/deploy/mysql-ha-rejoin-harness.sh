#!/usr/bin/env bash
set -Eeuo pipefail

RUN_HA_REJOIN_HARNESS="${RUN_HA_REJOIN_HARNESS:-false}"
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.0}"
REPORT_PATH="${REPORT_PATH:-/tmp/nodeaccess-mysql-ha-rejoin-harness.json}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"
RUN_ID="${RUN_ID:-$$}"
NETWORK_NAME="nodeaccess-ha-rejoin-${RUN_ID}"
MYSQL_A="nodeaccess-ha-rejoin-a-${RUN_ID}"
MYSQL_B="nodeaccess-ha-rejoin-b-${RUN_ID}"
ROOT_PASSWORD="nodeaccess-harness-root-${RUN_ID}"
REPLICATION_PASSWORD="nodeaccess-harness-repl-${RUN_ID}"

if [[ "$RUN_HA_REJOIN_HARNESS" != "true" ]]; then
  echo "[fail] Ensaio recusado. Execute com RUN_HA_REJOIN_HARNESS=true." >&2
  exit 1
fi

for command_name in docker awk sed; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "[fail] Comando obrigatório ausente: $command_name" >&2
    exit 1
  }
done

cleanup() {
  docker rm -f "$MYSQL_A" "$MYSQL_B" >/dev/null 2>&1 || true
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mysql_exec() {
  local container="$1"
  local sql="$2"
  docker exec -e MYSQL_PWD="$ROOT_PASSWORD" "$container" \
    mysql -uroot --batch --skip-column-names -e "$sql"
}

wait_mysql() {
  local container="$1"
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  until docker exec -e MYSQL_PWD="$ROOT_PASSWORD" "$container" \
    mysql -uroot --batch --skip-column-names -e "SELECT 1;" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      echo "[fail] MySQL não ficou pronto: $container" >&2
      return 1
    fi
    sleep 2
  done
}

wait_count() {
  local container="$1"
  local expected="$2"
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  local observed=""
  while ((SECONDS < deadline)); do
    observed="$(mysql_exec "$container" \
      "SELECT COUNT(*) FROM nodeaccess_ha_harness.events;" 2>/dev/null || true)"
    if [[ "$observed" == "$expected" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "[fail] $container não atingiu $expected registro(s); observado=${observed:-indisponível}" >&2
  return 1
}

replica_field() {
  local container="$1"
  local field="$2"
  docker exec -e MYSQL_PWD="$ROOT_PASSWORD" "$container" \
    mysql -uroot -e "SHOW REPLICA STATUS\\G" |
    awk -F': ' -v field="$field" '$1 ~ "^[[:space:]]*" field "$" { print $2; exit }'
}

assert_replica_healthy() {
  local container="$1"
  local io_status sql_status
  io_status="$(replica_field "$container" Replica_IO_Running)"
  sql_status="$(replica_field "$container" Replica_SQL_Running)"
  if [[ "$io_status" != "Yes" || "$sql_status" != "Yes" ]]; then
    echo "[fail] Réplica sem saúde em $container: io=$io_status sql=$sql_status" >&2
    mysql_exec "$container" "SHOW REPLICA STATUS\\G" >&2 || true
    return 1
  fi
}

echo "[nodeaccess] Criando topologia MySQL temporária..."
docker network create "$NETWORK_NAME" >/dev/null

for node_spec in "$MYSQL_A:1" "$MYSQL_B:2"; do
  container="${node_spec%:*}"
  server_id="${node_spec##*:}"
  docker run -d \
    --name "$container" \
    --network "$NETWORK_NAME" \
    -e MYSQL_ROOT_PASSWORD="$ROOT_PASSWORD" \
    "$MYSQL_IMAGE" \
    --server-id="$server_id" \
    --log-bin=mysql-bin \
    --log-replica-updates=ON \
    --gtid-mode=ON \
    --enforce-gtid-consistency=ON \
    --binlog-format=ROW >/dev/null
done

wait_mysql "$MYSQL_A"
wait_mysql "$MYSQL_B"

echo "[nodeaccess] Gate 1/5: criando registros iniciais no primário A..."
mysql_exec "$MYSQL_A" "
  CREATE USER 'nodeaccess_repl'@'%' IDENTIFIED WITH caching_sha2_password BY '$REPLICATION_PASSWORD';
  GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'nodeaccess_repl'@'%';
  CREATE DATABASE nodeaccess_ha_harness;
  CREATE TABLE nodeaccess_ha_harness.events (
    id BIGINT PRIMARY KEY,
    origin VARCHAR(16) NOT NULL,
    payload VARCHAR(128) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  ) ENGINE=InnoDB;
  INSERT INTO nodeaccess_ha_harness.events (id, origin, payload)
  VALUES (1, 'A', 'registro-criado-antes-da-queda');
"

echo "[nodeaccess] Gate 2/5: replicando A para B..."
mysql_exec "$MYSQL_B" "
  CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='$MYSQL_A',
    SOURCE_PORT=3306,
    SOURCE_USER='nodeaccess_repl',
    SOURCE_PASSWORD='$REPLICATION_PASSWORD',
    SOURCE_AUTO_POSITION=1,
    GET_SOURCE_PUBLIC_KEY=1;
  START REPLICA;
"
wait_count "$MYSQL_B" 1
assert_replica_healthy "$MYSQL_B"
mysql_exec "$MYSQL_B" "SET GLOBAL read_only=ON; SET GLOBAL super_read_only=ON;"

echo "[nodeaccess] Gate 3/5: simulando queda e fencing de A; promovendo B..."
docker stop "$MYSQL_A" >/dev/null
mysql_exec "$MYSQL_B" "
  STOP REPLICA;
  RESET REPLICA ALL;
  SET GLOBAL super_read_only=OFF;
  SET GLOBAL read_only=OFF;
"

echo "[nodeaccess] Gate 4/5: gravando novos registros somente em B..."
mysql_exec "$MYSQL_B" "
  INSERT INTO nodeaccess_ha_harness.events (id, origin, payload)
  VALUES (2, 'B', 'registro-criado-durante-a-queda-de-A');
"
wait_count "$MYSQL_B" 2

echo "[nodeaccess] Gate 5/5: retornando A como réplica de B..."
docker start "$MYSQL_A" >/dev/null
wait_mysql "$MYSQL_A"
count_a_before_rejoin="$(mysql_exec "$MYSQL_A" \
  "SELECT COUNT(*) FROM nodeaccess_ha_harness.events;")"
if [[ "$count_a_before_rejoin" != "1" ]]; then
  echo "[fail] A deveria retornar com apenas o registro anterior; observado=$count_a_before_rejoin" >&2
  exit 1
fi

mysql_exec "$MYSQL_A" "
  SET GLOBAL read_only=ON;
  SET GLOBAL super_read_only=ON;
  STOP REPLICA;
  RESET REPLICA ALL;
  CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='$MYSQL_B',
    SOURCE_PORT=3306,
    SOURCE_USER='nodeaccess_repl',
    SOURCE_PASSWORD='$REPLICATION_PASSWORD',
    SOURCE_AUTO_POSITION=1,
    GET_SOURCE_PUBLIC_KEY=1;
  START REPLICA;
"
wait_count "$MYSQL_A" 2
assert_replica_healthy "$MYSQL_A"

rows_a="$(mysql_exec "$MYSQL_A" \
  "SELECT id, origin, payload FROM nodeaccess_ha_harness.events ORDER BY id;")"
rows_b="$(mysql_exec "$MYSQL_B" \
  "SELECT id, origin, payload FROM nodeaccess_ha_harness.events ORDER BY id;")"
if [[ "$rows_a" != "$rows_b" ]]; then
  echo "[fail] Conteúdo divergente após rejoin." >&2
  echo "A:" >&2
  echo "$rows_a" >&2
  echo "B:" >&2
  echo "$rows_b" >&2
  exit 1
fi

read_only_a="$(mysql_exec "$MYSQL_A" \
  "SELECT @@global.read_only, @@global.super_read_only;")"
read_only_b="$(mysql_exec "$MYSQL_B" \
  "SELECT @@global.read_only, @@global.super_read_only;")"
gtid_a="$(mysql_exec "$MYSQL_A" "SELECT @@global.gtid_executed;")"
gtid_b="$(mysql_exec "$MYSQL_B" "SELECT @@global.gtid_executed;")"
missing_on_a="$(mysql_exec "$MYSQL_A" "SELECT GTID_SUBTRACT('$gtid_b', '$gtid_a');")"
errant_on_a="$(mysql_exec "$MYSQL_A" "SELECT GTID_SUBTRACT('$gtid_a', '$gtid_b');")"
if [[ -n "$missing_on_a" || -n "$errant_on_a" ]]; then
  echo "[fail] GTIDs ainda divergem após o rejoin: missing=$missing_on_a errant=$errant_on_a" >&2
  exit 1
fi

cat > "$REPORT_PATH" <<EOF
{
  "contract": "nodeaccess-mysql-ha-rejoin-v1",
  "status": "passed",
  "strategy": "single-writer-active-passive-with-replication-reversal",
  "recordsBeforeFailure": 1,
  "recordsWrittenOnPromotedB": 1,
  "recordsAfterRejoinOnA": 2,
  "recordsAfterRejoinOnB": 2,
  "aReadOnly": "$(sed 's/[[:space:]]/ /g' <<<"$read_only_a")",
  "bReadOnly": "$(sed 's/[[:space:]]/ /g' <<<"$read_only_b")",
  "gtidParity": true,
  "missingOnA": "",
  "errantOnA": "",
  "gtidA": "$(sed 's/"/\\"/g' <<<"$gtid_a")",
  "gtidB": "$(sed 's/"/\\"/g' <<<"$gtid_b")"
}
EOF

echo "[ok] Registros criados em B foram preservados e chegaram ao A após o rejoin."
echo "- A antes da queda: 1 registro"
echo "- B após promoção: 2 registros"
echo "- A após retorno como réplica de B: 2 registros"
echo "- relatório: $REPORT_PATH"
