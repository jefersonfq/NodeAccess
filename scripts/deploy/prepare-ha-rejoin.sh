#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${MODE:-check}"
CONFIRM_REJOIN="${CONFIRM_REJOIN:-false}"
ACTIVE_NODE_IP="${ACTIVE_NODE_IP:-}"
ACTIVE_MYSQL_PORT="${ACTIVE_MYSQL_PORT:-3307}"
ACTIVE_REDIS_PORT="${ACTIVE_REDIS_PORT:-6380}"
VIRTUAL_IP="${VIRTUAL_IP:-192.168.1.105}"
ENV_FILE="${ENV_FILE:-/opt/nodeaccess/shared/.env}"
REPLICATION_ENV="${REPLICATION_ENV:-/srv/nodeaccess-shared/mysql/replication.env}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-nodeaccess-state-mysql-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-nodeaccess-state-redis-1}"
STATE_COMPOSE_FILE="${STATE_COMPOSE_FILE:-/opt/nodeaccess/current/docker-compose.ha-state.yml}"
APP_DOCKER_NETWORK="${APP_DOCKER_NETWORK:-nodeaccess_default}"
NODE_IP="${NODE_IP:-}"
REDIS_VOLUME_NAME="${REDIS_VOLUME_NAME:-}"
MYSQL_REPLICA_CONFIG_SOURCE="${MYSQL_REPLICA_CONFIG_SOURCE:-/opt/nodeaccess/current/docker/mysql/ha/replica-node-a.cnf}"
MYSQL_REPLICA_CONFIG="${MYSQL_REPLICA_CONFIG:-/opt/nodeaccess/shared/mysql/replica-a-conf/nodeaccess.cnf}"
FILE_SYNC_ENV="${FILE_SYNC_ENV:-/etc/sysconfig/nodeaccess-ha-file-sync}"
FILE_SOURCE_ROOT="${FILE_SOURCE_ROOT:-}"
FILE_REPLICA_ROOT="${FILE_REPLICA_ROOT:-/srv/nodeaccess-shared}"
FILE_SYNC_SSH_KEY="${FILE_SYNC_SSH_KEY:-/root/.ssh/nodeaccess_ha_ed25519}"
FILE_SYNC_SCRIPT_SOURCE="${FILE_SYNC_SCRIPT_SOURCE:-/opt/nodeaccess/current/scripts/deploy/ha-file-replica-sync.sh}"
FILE_SYNC_SCRIPT_TARGET="${FILE_SYNC_SCRIPT_TARGET:-/opt/nodeaccess/scripts/deploy/ha-file-replica-sync.sh}"
FILE_SYNC_SERVICE_SOURCE="${FILE_SYNC_SERVICE_SOURCE:-/opt/nodeaccess/current/systemd/nodeaccess-ha-file-sync.service}"
FILE_SYNC_TIMER_SOURCE="${FILE_SYNC_TIMER_SOURCE:-/opt/nodeaccess/current/systemd/nodeaccess-ha-file-sync.timer}"
SYSTEMD_UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
STATE_STATUS_SCRIPT="${STATE_STATUS_SCRIPT:-/opt/nodeaccess/current/scripts/deploy/ha-state-replication-status.sh}"
FILE_STATUS_SCRIPT="${FILE_STATUS_SCRIPT:-/opt/nodeaccess/current/scripts/deploy/ha-file-replica-status.sh}"
WAIT_SECONDS="${WAIT_SECONDS:-120}"
REQUIRE_SOURCE_READ_ONLY="${REQUIRE_SOURCE_READ_ONLY:-false}"
REPORT_PATH="${REPORT_PATH:-/tmp/nodeaccess-ha-rejoin-readiness.json}"
KEEPALIVED_SERVICE="${KEEPALIVED_SERVICE:-keepalived}"
KEEPALIVED_CONFIG="${KEEPALIVED_CONFIG:-/etc/keepalived/keepalived.conf}"
AGENT_ENV_FILE="${AGENT_ENV_FILE:-/opt/nodeaccess-ha-agent/agent.env}"

fail() {
  echo "[fail] $*" >&2
  exit 1
}

read_env_value() {
  local file="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$file"
}

require_file() {
  [[ -f "$1" ]] || fail "Arquivo obrigatório ausente: $1"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Comando obrigatório ausente: $1"
}

mysql_local() {
  docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$MYSQL_CONTAINER" \
    mysql -uroot --batch --skip-column-names -e "$1"
}

mysql_source() {
  docker exec -e MYSQL_PWD="$MYSQL_REPLICATION_PASSWORD" "$MYSQL_CONTAINER" \
    mysql -h"$ACTIVE_NODE_IP" -P"$ACTIVE_MYSQL_PORT" \
      -u"$MYSQL_REPLICATION_USER" --batch --skip-column-names -e "$1"
}

configured_replica_root() {
  if [[ -f "$FILE_SYNC_ENV" ]]; then
    local configured
    configured="$(read_env_value "$FILE_SYNC_ENV" REPLICA_ROOT)"
    [[ -z "$configured" ]] || {
      printf '%s\n' "$configured"
      return
    }
  fi
  printf '%s\n' "$FILE_REPLICA_ROOT"
}

write_report() {
  local status="$1"
  local mysql_status="$2"
  local files_status="$3"
  local redis_status="$4"
  local errant_gtids="${5:-}"
  local data_consistency="${6:-not-checked}"
  local missing_source_gtids="${7:-}"
  cat > "$REPORT_PATH" <<EOF
{
  "contract": "nodeaccess-ha-rejoin-readiness-v1",
  "status": "$status",
  "mode": "$MODE",
  "activeNode": "${ACTIVE_NODE_IP:-not-set}",
  "mysql": "$mysql_status",
  "redis": "$redis_status",
  "files": "$files_status",
  "dataConsistency": "$data_consistency",
  "errantGtids": "$errant_gtids",
  "missingSourceGtids": "$missing_source_gtids",
  "readyForFailback": $(
    [[ "$status" == "ready" && "$data_consistency" == "ok" ]] &&
      echo true || echo false
  )
}
EOF
}

run_readiness() {
  local replica_root mysql_status=failed redis_status=failed files_status=failed
  local data_consistency=not-checked local_gtids="" source_gtids="" source_read_only=""
  local errant_gtids="" missing_source_gtids=""
  replica_root="$(configured_replica_root)"

  if ENV_FILE="$ENV_FILE" CHECK_COMPONENT=mysql \
    bash "$STATE_STATUS_SCRIPT" >/dev/null 2>&1; then
    mysql_status=ok
  fi
  if ENV_FILE="$ENV_FILE" CHECK_COMPONENT=redis \
    bash "$STATE_STATUS_SCRIPT" >/dev/null 2>&1; then
    redis_status=ok
  fi
  if REPLICA_ROOT="$replica_root" REQUIRE_SOURCE_MATCH=false \
    bash "$FILE_STATUS_SCRIPT" >/dev/null 2>&1; then
    files_status=ok
  fi

  if [[ -n "$ACTIVE_NODE_IP" && -n "${MYSQL_REPLICATION_USER:-}" &&
        -n "${MYSQL_REPLICATION_PASSWORD:-}" ]]; then
    local_gtids="$(mysql_local "SELECT @@GLOBAL.gtid_executed;")"
    source_gtids="$(mysql_source "SELECT @@GLOBAL.gtid_executed;")"
    source_read_only="$(mysql_source "SELECT CONCAT(@@GLOBAL.read_only, ':', @@GLOBAL.super_read_only);")"
    errant_gtids="$(mysql_local "SELECT GTID_SUBTRACT('$local_gtids', '$source_gtids');")"
    missing_source_gtids="$(mysql_local "SELECT GTID_SUBTRACT('$source_gtids', '$local_gtids');")"
    if [[ -z "$errant_gtids" && -z "$missing_source_gtids" ]]; then
      data_consistency=ok
    else
      data_consistency=failed
    fi
    if [[ "$REQUIRE_SOURCE_READ_ONLY" == true && "$source_read_only" != "1:1" ]]; then
      data_consistency=failed
    fi
  fi

  if [[ "$mysql_status" == "ok" && "$redis_status" == "ok" &&
        "$files_status" == "ok" && "$data_consistency" != "failed" ]]; then
    write_report ready "$mysql_status" "$files_status" "$redis_status" \
      "$errant_gtids" "$data_consistency" "$missing_source_gtids"
    if [[ "$data_consistency" == "ok" ]]; then
      echo "[ok] Nó sincronizado e pronto para failback controlado."
    else
      echo "[ok] Componentes sincronizados; informe ACTIVE_NODE_IP para validar o failback."
    fi
    echo "- relatório: $REPORT_PATH"
    return 0
  fi
  write_report blocked "$mysql_status" "$files_status" "$redis_status" \
    "$errant_gtids" "$data_consistency" "$missing_source_gtids"
  echo "[fail] Rejoin ainda bloqueado: mysql=$mysql_status redis=$redis_status files=$files_status data=$data_consistency" >&2
  return 1
}

[[ "$MODE" == "check" || "$MODE" == "apply" ]] ||
  fail "MODE deve ser check ou apply."
require_command docker
require_file "$ENV_FILE"
require_file "$STATE_STATUS_SCRIPT"
require_file "$FILE_STATUS_SCRIPT"
DB_ROOT_PASSWORD="$(read_env_value "$ENV_FILE" DB_ROOT_PASSWORD)"
[[ -n "$DB_ROOT_PASSWORD" ]] || fail "DB_ROOT_PASSWORD ausente em $ENV_FILE"
if [[ -z "$FILE_SOURCE_ROOT" ]]; then
  session_audit_host_dir="$(read_env_value "$ENV_FILE" SESSION_AUDIT_HOST_DIR)"
  if [[ "$session_audit_host_dir" == */session-audit ]]; then
    FILE_SOURCE_ROOT="${session_audit_host_dir%/session-audit}"
  else
    FILE_SOURCE_ROOT="/srv/nodeaccess-replica"
  fi
fi

if [[ -n "$ACTIVE_NODE_IP" ]]; then
  [[ "$ACTIVE_NODE_IP" =~ ^[0-9a-fA-F:.]+$ ]] ||
    fail "ACTIVE_NODE_IP inválido."
  require_file "$REPLICATION_ENV"
  MYSQL_REPLICATION_USER="$(read_env_value "$REPLICATION_ENV" MYSQL_REPLICATION_USER)"
  MYSQL_REPLICATION_PASSWORD="$(read_env_value "$REPLICATION_ENV" MYSQL_REPLICATION_PASSWORD)"
  [[ -n "$MYSQL_REPLICATION_USER" && -n "$MYSQL_REPLICATION_PASSWORD" ]] ||
    fail "Credenciais de replicação ausentes em $REPLICATION_ENV"
fi

if [[ "$MODE" == "check" ]]; then
  run_readiness
  exit $?
fi

[[ "$CONFIRM_REJOIN" == "true" ]] ||
  fail "Preparação recusada. Use CONFIRM_REJOIN=true."
[[ -n "$ACTIVE_NODE_IP" ]] ||
  fail "ACTIVE_NODE_IP ausente."
if ip -4 address show | grep -Fq "$VIRTUAL_IP/"; then
  fail "Este nó ainda possui o VIP $VIRTUAL_IP; aplique fencing antes do rejoin."
fi

require_file "$REPLICATION_ENV"
require_file "$MYSQL_REPLICA_CONFIG_SOURCE"
require_file "$FILE_SYNC_SSH_KEY"
require_file "$STATE_COMPOSE_FILE"

echo "[nodeaccess] Comparando GTIDs antes de alterar a replicação..."
local_gtids="$(mysql_local "SELECT @@GLOBAL.gtid_executed;")"
source_gtids="$(mysql_source "SELECT @@GLOBAL.gtid_executed;")"
errant_gtids="$(mysql_local "SELECT GTID_SUBTRACT('$local_gtids', '$source_gtids');")"
if [[ -n "$errant_gtids" ]]; then
  write_report blocked failed failed failed "$errant_gtids"
  fail "GTIDs locais não existem no primário atual; re-seed ou reconciliação é obrigatório."
fi

echo "[nodeaccess] Protegendo MySQL local e apontando a réplica para $ACTIVE_NODE_IP..."
install -D -m 0644 "$MYSQL_REPLICA_CONFIG_SOURCE" "$MYSQL_REPLICA_CONFIG"
mysql_local "
  SET GLOBAL super_read_only=ON;
  SET GLOBAL read_only=ON;
  STOP REPLICA;
  RESET REPLICA ALL;
  CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='$ACTIVE_NODE_IP',
    SOURCE_PORT=$ACTIVE_MYSQL_PORT,
    SOURCE_USER='$MYSQL_REPLICATION_USER',
    SOURCE_PASSWORD='$MYSQL_REPLICATION_PASSWORD',
    SOURCE_AUTO_POSITION=1,
    GET_SOURCE_PUBLIC_KEY=1;
  START REPLICA;
"

echo "[nodeaccess] Apontando Redis local para o primário atual..."
docker exec "$REDIS_CONTAINER" redis-cli \
  REPLICAOF "$ACTIVE_NODE_IP" "$ACTIVE_REDIS_PORT" >/dev/null
if [[ -z "$NODE_IP" ]]; then
  NODE_IP="$(
    ip -4 route get "$ACTIVE_NODE_IP" 2>/dev/null |
      awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }'
  )"
fi
[[ -n "$NODE_IP" ]] || fail "NODE_IP local não pôde ser determinado."
if [[ -z "$REDIS_VOLUME_NAME" ]]; then
  REDIS_VOLUME_NAME="$(
    docker inspect "$REDIS_CONTAINER" \
      --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}'
  )"
fi
[[ -n "$REDIS_VOLUME_NAME" ]] || fail "Volume persistente do Redis não pôde ser determinado."
echo "[nodeaccess] Persistindo a direção da réplica Redis após reboot..."
REDIS_BIND_ADDRESS="$NODE_IP" \
REDIS_PUBLISHED_PORT="$ACTIVE_REDIS_PORT" \
REDIS_VOLUME_NAME="$REDIS_VOLUME_NAME" \
REDIS_REPLICA_HOST="$ACTIVE_NODE_IP" \
REDIS_REPLICA_PORT="$ACTIVE_REDIS_PORT" \
docker compose -p nodeaccess-state -f "$STATE_COMPOSE_FILE" --env-file "$ENV_FILE" \
  up -d --force-recreate redis
docker network inspect "$APP_DOCKER_NETWORK" >/dev/null 2>&1 || \
  docker network create "$APP_DOCKER_NETWORK" >/dev/null
docker network connect --alias redis "$APP_DOCKER_NETWORK" "$REDIS_CONTAINER" \
  2>/dev/null || true

echo "[nodeaccess] Configurando cópia de arquivos do primário para este nó..."
require_file "$FILE_SYNC_SCRIPT_SOURCE"
require_file "$FILE_SYNC_SERVICE_SOURCE"
require_file "$FILE_SYNC_TIMER_SOURCE"
install -D -m 0755 "$FILE_SYNC_SCRIPT_SOURCE" "$FILE_SYNC_SCRIPT_TARGET"
install -D -m 0644 "$FILE_SYNC_SERVICE_SOURCE" \
  "$SYSTEMD_UNIT_DIR/nodeaccess-ha-file-sync.service"
install -D -m 0644 "$FILE_SYNC_TIMER_SOURCE" \
  "$SYSTEMD_UNIT_DIR/nodeaccess-ha-file-sync.timer"
systemctl daemon-reload
file_sync_tmp="${FILE_SYNC_ENV}.tmp"
{
  printf 'SOURCE_RSYNC=root@%s:%s\n' "$ACTIVE_NODE_IP" "$FILE_SOURCE_ROOT"
  printf 'REPLICA_ROOT=%s\n' "$FILE_REPLICA_ROOT"
  printf 'RSYNC_RSH=ssh -i %s -o BatchMode=yes -o StrictHostKeyChecking=accept-new\n' \
    "$FILE_SYNC_SSH_KEY"
} > "$file_sync_tmp"
chmod 0600 "$file_sync_tmp"
mv -f "$file_sync_tmp" "$FILE_SYNC_ENV"
systemctl enable --now nodeaccess-ha-file-sync.timer >/dev/null
systemctl start nodeaccess-ha-file-sync.service

deadline=$((SECONDS + WAIT_SECONDS))
until run_readiness; do
  if ((SECONDS >= deadline)); then
    fail "O nó não ficou pronto dentro de ${WAIT_SECONDS}s."
  fi
  sleep 5
done

echo "[nodeaccess] Persistindo papel STANDBY e prioridade secundária da VIP..."
if [[ -f "$AGENT_ENV_FILE" ]]; then
  cp -p "$AGENT_ENV_FILE" "${AGENT_ENV_FILE}.pre-rejoin-$(date +%Y%m%d-%H%M%S)"
  sed -i -E \
    's#^NODEACCESS_HA_NODE_ROLE=.*#NODEACCESS_HA_NODE_ROLE=STANDBY#' \
    "$AGENT_ENV_FILE"
fi
if [[ -f "$KEEPALIVED_CONFIG" ]]; then
  cp -p "$KEEPALIVED_CONFIG" "${KEEPALIVED_CONFIG}.pre-rejoin-$(date +%Y%m%d-%H%M%S)"
  sed -i -E \
    -e 's/^([[:space:]]*)state[[:space:]]+(BACKUP|MASTER)/\1state BACKUP/' \
    -e 's/^([[:space:]]*)priority[[:space:]]+[0-9]+/\1priority 100/' \
    "$KEEPALIVED_CONFIG"
  systemctl enable --now "$KEEPALIVED_SERVICE" >/dev/null
fi
rm -f /opt/nodeaccess/shared/ha/primary-quiesced
systemctl enable --now nodeaccess-ha-agent.timer >/dev/null 2>&1 || true
systemctl start nodeaccess-ha-agent.service >/dev/null 2>&1 || true
