#!/usr/bin/env bash
set -euo pipefail

CONFIRM_PROMOTION="${CONFIRM_PROMOTION:-false}"
ENV_FILE="${ENV_FILE:-/opt/nodeaccess/shared/.env}"
APP_COMPOSE_FILE="${APP_COMPOSE_FILE:-/opt/nodeaccess/current/docker-compose.ha.yml}"
STATE_COMPOSE_FILE="${STATE_COMPOSE_FILE:-/opt/nodeaccess/current/docker-compose.ha-state.yml}"
FILE_SYNC_ENV_FILE="${FILE_SYNC_ENV_FILE:-/etc/sysconfig/nodeaccess-ha-file-sync}"
if [[ -z "${REPLICA_ROOT:-}" && -f "$FILE_SYNC_ENV_FILE" ]]; then
  REPLICA_ROOT="$(
    awk -F= '$1 == "REPLICA_ROOT" { print substr($0, index($0, "=") + 1); exit }' \
      "$FILE_SYNC_ENV_FILE"
  )"
fi
REPLICA_ROOT="${REPLICA_ROOT:-/srv/nodeaccess-replica}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-nodeaccess-state-mysql-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-nodeaccess-state-redis-1}"
MYSQL_PROMOTED_CONFIG="${MYSQL_PROMOTED_CONFIG:-}"
MYSQL_PROMOTED_CONFIG_SOURCE="${MYSQL_PROMOTED_CONFIG_SOURCE:-/opt/nodeaccess/current/docker/mysql/ha/promoted.cnf}"
MYSQL_VOLUME_NAME="${MYSQL_VOLUME_NAME:-}"
REDIS_VOLUME_NAME="${REDIS_VOLUME_NAME:-}"
NODE_IP="${NODE_IP:-192.168.1.101}"
VIRTUAL_IP="${VIRTUAL_IP:-192.168.1.105}"
MYSQL_PORT="${MYSQL_PORT:-3307}"
REDIS_PORT="${REDIS_PORT:-6380}"
APP_DOCKER_NETWORK="${APP_DOCKER_NETWORK:-nodeaccess_default}"
WITNESS_VERIFY_SCRIPT="${WITNESS_VERIFY_SCRIPT:-/opt/nodeaccess/current/scripts/deploy/ha-witness-verify-evidence.sh}"
WITNESS_EVIDENCE_FILE="${WITNESS_EVIDENCE_FILE:-}"
WITNESS_SIGNATURE_FILE="${WITNESS_SIGNATURE_FILE:-${WITNESS_EVIDENCE_FILE}.sig}"
WITNESS_PUBLIC_KEY="${WITNESS_PUBLIC_KEY:-/opt/nodeaccess/shared/ha/witness-public.pem}"
PRIMARY_NODE_ID="${PRIMARY_NODE_ID:-}"
STANDBY_NODE_ID="${STANDBY_NODE_ID:-}"
OPERATION_ID="${OPERATION_ID:-}"
JOURNAL_DIR="${JOURNAL_DIR:-/opt/nodeaccess/shared/ha/operations}"
PLAN_SCRIPT="${PLAN_SCRIPT:-/opt/nodeaccess/current/scripts/deploy/plan-ha-promotion.sh}"
NONCE_STORE_DIR="${NONCE_STORE_DIR:-/opt/nodeaccess/shared/ha/consumed-nonces}"
FINAL_SYNC_SOURCE_IP="${FINAL_SYNC_SOURCE_IP:-}"
FINAL_SYNC_SCRIPT="${FINAL_SYNC_SCRIPT:-/opt/nodeaccess/current/scripts/deploy/prepare-ha-rejoin.sh}"
KEEPALIVED_SERVICE="${KEEPALIVED_SERVICE:-keepalived}"
KEEPALIVED_CONFIG="${KEEPALIVED_CONFIG:-/etc/keepalived/keepalived.conf}"
AGENT_ENV_FILE="${AGENT_ENV_FILE:-/opt/nodeaccess-ha-agent/agent.env}"
APP_TLS_MODE="${APP_TLS_MODE:-}"
APP_NGINX_CONFIG_FILE="${APP_NGINX_CONFIG_FILE:-}"
ALLOW_SOURCE_DOWN=false
[[ -z "$FINAL_SYNC_SOURCE_IP" ]] && ALLOW_SOURCE_DOWN=true
current_stage="initializing"

[[ "$OPERATION_ID" =~ ^[A-Za-z0-9._:-]{8,100}$ ]] || {
  echo "[fail] OPERATION_ID obrigatorio e invalido." >&2
  exit 1
}
mkdir -p "$JOURNAL_DIR"
chmod 0700 "$JOURNAL_DIR"
JOURNAL_FILE="${JOURNAL_DIR}/${OPERATION_ID}.jsonl"
touch "$JOURNAL_FILE"
chmod 0600 "$JOURNAL_FILE"

record_checkpoint() {
  local stage="$1"
  local status="$2"
  local message="$3"
  current_stage="$stage"
  (
    flock 9
    printf '{"contract":"nodeaccess-ha-operation-v1","operationId":"%s","stage":"%s","status":"%s","message":"%s","observedAt":"%s"}\n' \
      "$OPERATION_ID" "$stage" "$status" "$message" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&9
  ) 9>>"$JOURNAL_FILE"
}

on_error() {
  local exit_code="$?"
  record_checkpoint "$current_stage" failed "Etapa interrompida; consulte a saida e retome somente apos diagnostico"
  exit "$exit_code"
}
trap on_error ERR

if [[ "$CONFIRM_PROMOTION" != "true" ]]; then
  echo "[fail] Promocao recusada. Execute com CONFIRM_PROMOTION=true." >&2
  exit 1
fi

[[ -f "$WITNESS_VERIFY_SCRIPT" ]] || {
  echo "[fail] Verificador de witness ausente: $WITNESS_VERIFY_SCRIPT" >&2
  exit 1
}

if [[ -z "$MYSQL_VOLUME_NAME" ]]; then
  MYSQL_VOLUME_NAME="$(
    docker inspect "$MYSQL_CONTAINER" \
      --format '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}'
  )"
fi
if [[ -z "$REDIS_VOLUME_NAME" ]]; then
  REDIS_VOLUME_NAME="$(
    docker inspect "$REDIS_CONTAINER" \
      --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}'
  )"
fi
if [[ -z "$MYSQL_PROMOTED_CONFIG" ]]; then
  mysql_config_dir="$(
    docker inspect "$MYSQL_CONTAINER" \
      --format '{{range .Mounts}}{{if eq .Destination "/etc/mysql/conf.d"}}{{.Source}}{{end}}{{end}}'
  )"
  MYSQL_PROMOTED_CONFIG="${mysql_config_dir}/zz-ha-role.cnf"
fi
[[ -n "$MYSQL_VOLUME_NAME" && -n "$REDIS_VOLUME_NAME" &&
    "$MYSQL_PROMOTED_CONFIG" == /* ]] || {
  echo "[fail] Não foi possível descobrir volumes/configuração do estado local." >&2
  exit 1
}

if [[ -n "$FINAL_SYNC_SOURCE_IP" ]]; then
  [[ -f "$FINAL_SYNC_SCRIPT" ]] || {
    echo "[fail] Verificador de sincronização final ausente: $FINAL_SYNC_SCRIPT" >&2
    exit 1
  }
  record_checkpoint source-fencing-barrier running "Aguardando origem somente leitura e VIP sem proprietário"
  source_fenced=false
  for _ in $(seq 1 40); do
    if ! curl -skS --connect-timeout 2 --max-time 3 \
      -o /dev/null "https://${VIRTUAL_IP}/" 2>/dev/null; then
      if MODE=check \
        ACTIVE_NODE_IP="$FINAL_SYNC_SOURCE_IP" \
        REQUIRE_SOURCE_READ_ONLY=true \
        REPORT_PATH="${JOURNAL_DIR}/${OPERATION_ID}.source-fencing.json" \
          bash "$FINAL_SYNC_SCRIPT" >/dev/null 2>&1; then
        source_fenced=true
        break
      fi
    fi
    sleep 3
  done
  [[ "$source_fenced" == true ]] || {
    echo "[fail] Promoção bloqueada: a origem não confirmou read_only/super_read_only ou a VIP ainda responde." >&2
    exit 1
  }
  record_checkpoint source-fencing-barrier completed "Origem somente leitura e VIP indisponível confirmadas"
  record_checkpoint final-sync-barrier running "Comparando GTIDs finais com a origem congelada"
  MODE=check \
  ACTIVE_NODE_IP="$FINAL_SYNC_SOURCE_IP" \
  REQUIRE_SOURCE_READ_ONLY=true \
  REPORT_PATH="${JOURNAL_DIR}/${OPERATION_ID}.final-sync.json" \
    bash "$FINAL_SYNC_SCRIPT"
  record_checkpoint final-sync-barrier completed "Paridade final de GTID e componentes aprovada"
fi

record_checkpoint promotion-plan running "Validando plano somente leitura"
OPERATION_ID="$OPERATION_ID" \
PRIMARY_NODE_ID="$PRIMARY_NODE_ID" \
STANDBY_NODE_ID="$STANDBY_NODE_ID" \
VIRTUAL_IP="${VIRTUAL_IP:-192.168.1.105}" \
WITNESS_EVIDENCE_FILE="$WITNESS_EVIDENCE_FILE" \
WITNESS_SIGNATURE_FILE="$WITNESS_SIGNATURE_FILE" \
WITNESS_PUBLIC_KEY="$WITNESS_PUBLIC_KEY" \
WITNESS_VERIFY_SCRIPT="$WITNESS_VERIFY_SCRIPT" \
ENV_FILE="$ENV_FILE" \
REPLICA_ROOT="$REPLICA_ROOT" \
ALLOW_SOURCE_DOWN="$ALLOW_SOURCE_DOWN" \
JOURNAL_DIR="$JOURNAL_DIR" \
  bash "$PLAN_SCRIPT"
record_checkpoint promotion-plan completed "Plano somente leitura aprovado"

echo "[nodeaccess] Validando evidencia externa de fencing..."
record_checkpoint fencing-evidence running "Consumindo evidencia externa de fencing"
EVIDENCE_FILE="$WITNESS_EVIDENCE_FILE" \
SIGNATURE_FILE="$WITNESS_SIGNATURE_FILE" \
PUBLIC_KEY="$WITNESS_PUBLIC_KEY" \
EXPECTED_PRIMARY_NODE_ID="$PRIMARY_NODE_ID" \
EXPECTED_STANDBY_NODE_ID="$STANDBY_NODE_ID" \
CONSUME_NONCE=true \
NONCE_STORE_DIR="$NONCE_STORE_DIR" \
  bash "$WITNESS_VERIFY_SCRIPT"
record_checkpoint fencing-evidence completed "Evidencia valida e nonce consumido"

for required_path in "$ENV_FILE" "$APP_COMPOSE_FILE" "$STATE_COMPOSE_FILE" "$MYSQL_PROMOTED_CONFIG_SOURCE"; do
  [[ -f "$required_path" ]] || {
    echo "[fail] Arquivo obrigatorio ausente: $required_path" >&2
    exit 1
  }
done

REQUIRE_SOURCE_MATCH=false REPLICA_ROOT="$REPLICA_ROOT" \
  bash /opt/nodeaccess/current/scripts/deploy/ha-file-replica-status.sh

record_checkpoint file-sync completed "Replica de arquivos validada"
systemctl disable --now nodeaccess-ha-file-sync.timer >/dev/null 2>&1 || true
record_checkpoint file-sync-timer completed "Sincronizacao periodica interrompida"

db_root_password="$(
  awk -F= '$1 == "DB_ROOT_PASSWORD" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE"
)"
[[ -n "$db_root_password" ]] || {
  echo "[fail] DB_ROOT_PASSWORD ausente em $ENV_FILE" >&2
  exit 1
}

echo "[nodeaccess] Promovendo MySQL replica..."
record_checkpoint mysql-promotion running "Promovendo MySQL replica"
docker exec -e MYSQL_PWD="$db_root_password" "$MYSQL_CONTAINER" \
  mysql -uroot -e \
  'STOP REPLICA; RESET REPLICA ALL; SET GLOBAL read_only=OFF; SET GLOBAL super_read_only=OFF;'
install -m 0644 "$MYSQL_PROMOTED_CONFIG_SOURCE" "$MYSQL_PROMOTED_CONFIG"
record_checkpoint mysql-promotion completed "MySQL promovido e configuracao persistida"

echo "[nodeaccess] Promovendo Redis replica..."
record_checkpoint redis-promotion running "Promovendo Redis replica"
docker exec "$REDIS_CONTAINER" redis-cli REPLICAOF NO ONE >/dev/null
MYSQL_BIND_ADDRESS="$NODE_IP" \
MYSQL_PUBLISHED_PORT="$MYSQL_PORT" \
MYSQL_CONFIG_DIR="$(dirname "$MYSQL_PROMOTED_CONFIG")" \
MYSQL_VOLUME_NAME="$MYSQL_VOLUME_NAME" \
REDIS_BIND_ADDRESS="$NODE_IP" \
REDIS_PUBLISHED_PORT="$REDIS_PORT" \
REDIS_VOLUME_NAME="$REDIS_VOLUME_NAME" \
REDIS_REPLICA_HOST="" \
docker compose -p nodeaccess-state -f "$STATE_COMPOSE_FILE" --env-file "$ENV_FILE" \
  up -d --force-recreate redis
record_checkpoint redis-promotion completed "Redis promovido"

docker network inspect "$APP_DOCKER_NETWORK" >/dev/null 2>&1 || \
  docker network create "$APP_DOCKER_NETWORK" >/dev/null
docker network connect --alias mysql "$APP_DOCKER_NETWORK" "$MYSQL_CONTAINER" 2>/dev/null || true
docker network connect --alias redis "$APP_DOCKER_NETWORK" "$REDIS_CONTAINER" 2>/dev/null || true

replace_env_value() {
  local key="$1"
  local value="$2"
  local tmp_file="${ENV_FILE}.tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print key "=" value
    }
  ' "$ENV_FILE" > "$tmp_file"
  chmod --reference="$ENV_FILE" "$tmp_file" 2>/dev/null || chmod 0600 "$tmp_file"
  mv -f "$tmp_file" "$ENV_FILE"
}

database_url="$(awk -F= '$1 == "DATABASE_URL" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
redis_url="$(awk -F= '$1 == "REDIS_URL" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
database_url="$(sed -E 's#@[^/:]+:[0-9]+/#@mysql:3306/#' <<<"$database_url")"
redis_url="redis://redis:6379"

env_backup="${ENV_FILE}.pre-promotion-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$env_backup"
replace_env_value DATABASE_URL "$database_url"
replace_env_value DB_HOST mysql
replace_env_value DB_PORT 3306
replace_env_value REDIS_URL "$redis_url"
replace_env_value SESSION_AUDIT_STORAGE_DIR "${REPLICA_ROOT}/session-audit"
replace_env_value USER_AVATAR_STORAGE_DIR "${REPLICA_ROOT}/user-avatars"
replace_env_value SESSION_AUDIT_HOST_DIR "${REPLICA_ROOT}/session-audit"
replace_env_value USER_AVATAR_HOST_DIR "${REPLICA_ROOT}/user-avatars"
replace_env_value BACKUP_DIR "${REPLICA_ROOT}/backups"

if [[ -z "$APP_TLS_MODE" ]]; then
  APP_TLS_MODE="$(awk -F= '$1 == "TLS_MODE" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
fi
APP_TLS_MODE="${APP_TLS_MODE:-off}"
if [[ -z "$APP_NGINX_CONFIG_FILE" ]]; then
  if [[ "$APP_TLS_MODE" == "off" ]]; then
    APP_NGINX_CONFIG_FILE="/opt/nodeaccess/current/docker/nginx.http.conf"
  else
    APP_NGINX_CONFIG_FILE="/opt/nodeaccess/current/docker/nginx.https.conf"
  fi
fi
if [[ "$APP_TLS_MODE" == "off" ]]; then
  APP_SCHEME="http"
else
  APP_SCHEME="https"
fi

echo "[nodeaccess] Recriando aplicacao com estado local promovido..."
record_checkpoint application-switch running "Recriando aplicacao com estado local"
TLS_MODE="$APP_TLS_MODE" NGINX_CONFIG_FILE="$APP_NGINX_CONFIG_FILE" \
docker compose -p nodeaccess -f "$APP_COMPOSE_FILE" --env-file "$ENV_FILE" \
  up -d --force-recreate --no-deps api ssh-gateway frontend
record_checkpoint application-switch completed "Aplicacao recriada"

record_checkpoint smoke-check running "Validando aplicacao promovida"
ENV_FILE="$ENV_FILE" APP_URL_OVERRIDE="${APP_SCHEME}://${NODE_IP}" \
  bash /opt/nodeaccess/current/scripts/install/smoke-check.sh
record_checkpoint role-persistence running "Persistindo papel do agente e prioridade da VIP"
if [[ -f "$AGENT_ENV_FILE" ]]; then
  cp -p "$AGENT_ENV_FILE" "${AGENT_ENV_FILE}.pre-promotion-${OPERATION_ID}"
  sed -i -E \
    -e 's#^NODEACCESS_HA_NODE_ROLE=.*#NODEACCESS_HA_NODE_ROLE=PRIMARY#' \
    -e "s#^NODEACCESS_HA_PRIMARY_STORAGE_ROOT=.*#NODEACCESS_HA_PRIMARY_STORAGE_ROOT=${REPLICA_ROOT}#" \
    "$AGENT_ENV_FILE"
fi
if [[ -f "$KEEPALIVED_CONFIG" ]]; then
  cp -p "$KEEPALIVED_CONFIG" "${KEEPALIVED_CONFIG}.pre-promotion-${OPERATION_ID}"
  sed -i -E \
    -e 's/^([[:space:]]*)state[[:space:]]+(BACKUP|MASTER)/\1state MASTER/' \
    -e 's/^([[:space:]]*)priority[[:space:]]+[0-9]+/\1priority 110/' \
    "$KEEPALIVED_CONFIG"
  systemctl restart "$KEEPALIVED_SERVICE"
fi
systemctl start nodeaccess-ha-agent.timer >/dev/null 2>&1 || true
systemctl start nodeaccess-ha-agent.service >/dev/null 2>&1 || true
record_checkpoint role-persistence completed "Papel PRIMARY e prioridade da VIP persistidos"
record_checkpoint completed completed "Promocao manual concluida"
trap - ERR

echo "[ok] Standby promovido manualmente."
echo "- node_ip: $NODE_IP"
echo "- mysql: ${NODE_IP}:${MYSQL_PORT}"
echo "- redis: ${NODE_IP}:${REDIS_PORT}"
echo "- storage: $REPLICA_ROOT"
echo "- env_backup: $env_backup"
echo "- journal: $JOURNAL_FILE"
echo "- aviso: o antigo primario nao deve voltar como gravavel sem re-seed/failback controlado"
