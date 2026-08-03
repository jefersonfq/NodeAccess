#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/nodeaccess/shared/.env}"
MYSQL_REPLICA_CONTAINER="${MYSQL_REPLICA_CONTAINER:-nodeaccess-state-mysql-1}"
REDIS_REPLICA_CONTAINER="${REDIS_REPLICA_CONTAINER:-nodeaccess-state-redis-1}"
MAX_MYSQL_LAG_SECONDS="${MAX_MYSQL_LAG_SECONDS:-10}"
CHECK_COMPONENT="${CHECK_COMPONENT:-all}"
OUTPUT_FORMAT="${OUTPUT_FORMAT:-text}"
ALLOW_SOURCE_DOWN="${ALLOW_SOURCE_DOWN:-false}"

json_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g' <<<"$1" | tr -d '\n'
}

emit_json() {
  local status="$1"
  local code="$2"
  local message="$3"
  local details="${4-}"
  [[ -n "$details" ]] || details='{}'
  printf '{"contract":"nodeaccess-ha-status-v1","check":"state-replication","component":"%s","status":"%s","observedAt":"%s","details":%s,"error":' \
    "$CHECK_COMPONENT" "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$details"
  if [[ "$status" == "ok" ]]; then
    printf 'null}\n'
  else
    printf '{"code":"%s","message":"%s"}}\n' "$code" "$(json_escape "$message")"
  fi
}

fail() {
  local code="$1"
  local message="$2"
  local details="${3-}"
  [[ -n "$details" ]] || details='{}'
  if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    emit_json failed "$code" "$message" "$details"
  else
    echo "[fail] $message" >&2
  fi
  exit 1
}

[[ "$CHECK_COMPONENT" == "all" || "$CHECK_COMPONENT" == "mysql" || "$CHECK_COMPONENT" == "redis" ]] || {
  fail invalid_component "CHECK_COMPONENT deve ser all, mysql ou redis."
}
[[ "$OUTPUT_FORMAT" == "text" || "$OUTPUT_FORMAT" == "json" ]] ||
  fail invalid_output_format "OUTPUT_FORMAT deve ser text ou json."

[[ -f "$ENV_FILE" ]] || {
  fail env_file_missing "Arquivo de ambiente ausente: $ENV_FILE"
}

if [[ "$CHECK_COMPONENT" != "redis" ]]; then
  DB_ROOT_PASSWORD="$(
    awk -F= '$1 == "DB_ROOT_PASSWORD" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE"
  )"
  [[ -n "$DB_ROOT_PASSWORD" ]] || {
    fail db_root_password_missing "DB_ROOT_PASSWORD ausente em $ENV_FILE"
  }

  mysql_status="$(
    docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$MYSQL_REPLICA_CONTAINER" \
      mysql -uroot -e 'SHOW REPLICA STATUS\G'
  )"

  mysql_io="$(awk -F': ' '/Replica_IO_Running:/ { print $2; exit }' <<<"$mysql_status" | tr -d '\r')"
  mysql_sql="$(awk -F': ' '/Replica_SQL_Running:/ { print $2; exit }' <<<"$mysql_status" | tr -d '\r')"
  mysql_lag="$(awk -F': ' '/Seconds_Behind_Source:/ { print $2; exit }' <<<"$mysql_status" | tr -d '\r')"
  mysql_error="$(awk -F': ' '/Last_(IO|SQL)_Error:/ && length($2) > 0 { print $2; exit }' <<<"$mysql_status" | tr -d '\r')"

  mysql_ready=false
  if [[ "$ALLOW_SOURCE_DOWN" == "true" ]]; then
    # Após fencing confirmado a origem pode estar desligada. O IO thread e o
    # lag ficam indisponíveis; ainda exigimos o SQL thread íntegro e sem erro.
    [[ "$mysql_sql" == "Yes" && -z "$mysql_error" ]] && mysql_ready=true
  elif [[ "$mysql_io" == "Yes" && "$mysql_sql" == "Yes" &&
      "$mysql_lag" =~ ^[0-9]+$ && "$mysql_lag" -le "$MAX_MYSQL_LAG_SECONDS" &&
      -z "$mysql_error" ]]; then
    mysql_ready=true
  fi
  if [[ "$mysql_ready" != true ]]; then
    mysql_details="$(printf '{"ioRunning":"%s","sqlRunning":"%s","lagSeconds":%s,"maxLagSeconds":%s}' \
      "${mysql_io:-unknown}" "${mysql_sql:-unknown}" \
      "$([[ "$mysql_lag" =~ ^[0-9]+$ ]] && printf '%s' "$mysql_lag" || printf 'null')" \
      "$MAX_MYSQL_LAG_SECONDS")"
    fail mysql_replica_not_ready \
      "MySQL replica fora do gate: io=${mysql_io:-unknown} sql=${mysql_sql:-unknown} lag=${mysql_lag:-unknown} error=${mysql_error:-none}" \
      "$mysql_details"
  fi
  if [[ "$OUTPUT_FORMAT" == "text" ]]; then
    echo "[ok] MySQL replica: io=$mysql_io sql=$mysql_sql lag_seconds=$mysql_lag"
  fi
fi

if [[ "$CHECK_COMPONENT" != "mysql" ]]; then
  redis_status="$(docker exec "$REDIS_REPLICA_CONTAINER" redis-cli INFO replication | tr -d '\r')"
  redis_role="$(awk -F: '$1 == "role" { print $2; exit }' <<<"$redis_status")"
  redis_link="$(awk -F: '$1 == "master_link_status" { print $2; exit }' <<<"$redis_status")"
  redis_sync="$(awk -F: '$1 == "master_sync_in_progress" { print $2; exit }' <<<"$redis_status")"

  redis_ready=false
  if [[ "$redis_role" == "slave" && "$redis_sync" == "0" ]]; then
    if [[ "$redis_link" == "up" || "$ALLOW_SOURCE_DOWN" == "true" ]]; then
      redis_ready=true
    fi
  fi
  if [[ "$redis_ready" != true ]]; then
    redis_details="$(printf '{"role":"%s","masterLinkStatus":"%s","syncInProgress":%s}' \
      "${redis_role:-unknown}" "${redis_link:-unknown}" \
      "$([[ "$redis_sync" =~ ^[0-9]+$ ]] && printf '%s' "$redis_sync" || printf 'null')")"
    fail redis_replica_not_ready \
      "Redis replica fora do gate: role=${redis_role:-unknown} link=${redis_link:-unknown} sync=${redis_sync:-unknown}" \
      "$redis_details"
  fi
  if [[ "$OUTPUT_FORMAT" == "text" ]]; then
    echo "[ok] Redis replica: role=$redis_role link=$redis_link sync_in_progress=$redis_sync"
  fi
fi

if [[ "$OUTPUT_FORMAT" == "json" ]]; then
  case "$CHECK_COMPONENT" in
    mysql)
      emit_json ok "" "" \
        "$(printf '{"ioRunning":"%s","sqlRunning":"%s","lagSeconds":%s,"maxLagSeconds":%s}' \
          "$mysql_io" "$mysql_sql" "$mysql_lag" "$MAX_MYSQL_LAG_SECONDS")"
      ;;
    redis)
      emit_json ok "" "" \
        "$(printf '{"role":"%s","masterLinkStatus":"%s","syncInProgress":%s}' \
          "$redis_role" "$redis_link" "$redis_sync")"
      ;;
    all)
      emit_json ok "" "" \
        "$(printf '{"mysql":{"ioRunning":"%s","sqlRunning":"%s","lagSeconds":%s,"maxLagSeconds":%s},"redis":{"role":"%s","masterLinkStatus":"%s","syncInProgress":%s}}' \
          "$mysql_io" "$mysql_sql" "$mysql_lag" "$MAX_MYSQL_LAG_SECONDS" \
          "$redis_role" "$redis_link" "$redis_sync")"
      ;;
  esac
else
  echo "[nodeaccess] Replicacao de estado pronta para ensaio de promocao manual."
fi
