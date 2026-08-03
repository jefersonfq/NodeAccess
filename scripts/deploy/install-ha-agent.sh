#!/usr/bin/env bash
set -Eeuo pipefail

API_URL=""
NODE_ID=""
NODE_ROLE="${NODEACCESS_HA_NODE_ROLE:-STANDBY}"
VIRTUAL_IP="${NODEACCESS_HA_VIRTUAL_IP:-}"
INSTALL_ROOT="${NODEACCESS_HA_AGENT_ROOT:-/opt/nodeaccess-ha-agent}"
ENV_FILE="${NODEACCESS_ENV_FILE:-/opt/nodeaccess/shared/.env}"
SYSTEMD_UNIT_DIR="${NODEACCESS_HA_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
DEPLOY_ROOT="${NODEACCESS_DEPLOY_ROOT:-/opt/nodeaccess}"
AGENT_STATE_ROOT="${NODEACCESS_HA_STATE_ROOT:-/var/lib/nodeaccess-ha-agent}"
RELEASE_ROOT="${NODEACCESS_HA_RELEASE_ROOT:-/opt/nodeaccess/current}"

usage() {
  echo "Uso: NODEACCESS_HA_ENROLLMENT_TOKEN=... $0 --api-url URL --node-id UUID [--role PRIMARY|STANDBY] [--virtual-ip IP]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --node-id) NODE_ID="${2:-}"; shift 2 ;;
    --role) NODE_ROLE="${2:-}"; shift 2 ;;
    --virtual-ip) VIRTUAL_IP="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[nodeaccess-ha-agent] Execute como root." >&2
  exit 1
fi
if [[ -z "$API_URL" || -z "$NODE_ID" || -z "$VIRTUAL_IP" || -z "${NODEACCESS_HA_ENROLLMENT_TOKEN:-}" ]]; then
  usage >&2
  [[ -n "$VIRTUAL_IP" ]] || echo "[nodeaccess-ha-agent] Informe a VIP com --virtual-ip; ela deve ser a mesma nos dois nós." >&2
  exit 2
fi
if [[ "$NODE_ROLE" != "PRIMARY" && "$NODE_ROLE" != "STANDBY" ]]; then
  echo "[nodeaccess-ha-agent] --role deve ser PRIMARY ou STANDBY." >&2
  exit 2
fi
if [[ ! "$VIRTUAL_IP" =~ ^[0-9a-fA-F:.]+$ ]]; then
  echo "[nodeaccess-ha-agent] --virtual-ip inválido." >&2
  exit 2
fi
if [[ "$API_URL" != https://* && "${NODEACCESS_HA_ALLOW_HTTP:-false}" != "true" ]]; then
  echo "[nodeaccess-ha-agent] HTTPS e obrigatorio. Para uma POC isolada, use NODEACCESS_HA_ALLOW_HTTP=true." >&2
  exit 1
fi
command -v curl >/dev/null || { echo "[nodeaccess-ha-agent] curl ausente." >&2; exit 1; }
command -v openssl >/dev/null || { echo "[nodeaccess-ha-agent] openssl ausente." >&2; exit 1; }

mkdir -p "$INSTALL_ROOT"
chmod 700 "$INSTALL_ROOT"
helper_candidate="$INSTALL_ROOT/privileged-helper.sh.candidate"
curl -fsS --max-time 30 \
  -H "Authorization: Bearer $NODEACCESS_HA_ENROLLMENT_TOKEN" \
  "${API_URL%/}/ha/agent/privileged-helper.sh" > "$helper_candidate"
grep -Fq 'ação não permitida; use schedule-quiesce-primary, quiesce-primary, rollback-primary, schedule-promote-standby ou promote-standby' \
  "$helper_candidate" || {
    rm -f "$helper_candidate"
    echo "[nodeaccess-ha-agent] Helper privilegiado retornou contrato inesperado." >&2
    exit 1
  }
install -o root -g root -m 0700 "$helper_candidate" "$INSTALL_ROOT/privileged-helper.sh"
rm -f "$helper_candidate"
mkdir -p "$SYSTEMD_UNIT_DIR"
install -d -m 0755 "$DEPLOY_ROOT"
install -d -m 0700 "$AGENT_STATE_ROOT"
PRIVATE_KEY_FILE="$AGENT_STATE_ROOT/provisioning-private.pem"
PUBLIC_KEY_FILE="$AGENT_STATE_ROOT/provisioning-public.pem"
if [[ ! -s "$PRIVATE_KEY_FILE" || ! -s "$PUBLIC_KEY_FILE" ]]; then
  umask 077
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$PRIVATE_KEY_FILE" >/dev/null 2>&1
  openssl pkey -in "$PRIVATE_KEY_FILE" -pubout -out "$PUBLIC_KEY_FILE" >/dev/null 2>&1
fi
chmod 600 "$PRIVATE_KEY_FILE"
chmod 644 "$PUBLIC_KEY_FILE"

install -m 600 /dev/null "$INSTALL_ROOT/agent.env"
{
  printf 'NODEACCESS_HA_API_URL=%q\n' "${API_URL%/}"
  printf 'NODEACCESS_HA_NODE_ID=%q\n' "$NODE_ID"
  printf 'NODEACCESS_HA_ENROLLMENT_TOKEN=%q\n' "$NODEACCESS_HA_ENROLLMENT_TOKEN"
  printf 'NODEACCESS_ENV_FILE=%q\n' "$ENV_FILE"
  printf 'NODEACCESS_HA_NODE_ROLE=%q\n' "$NODE_ROLE"
  printf 'NODEACCESS_HA_VIRTUAL_IP=%q\n' "$VIRTUAL_IP"
  printf 'NODEACCESS_HA_ALLOW_HTTP=%q\n' "${NODEACCESS_HA_ALLOW_HTTP:-false}"
  printf 'NODEACCESS_DEPLOY_ROOT=%q\n' "$DEPLOY_ROOT"
  printf 'NODEACCESS_HA_STATE_ROOT=%q\n' "$AGENT_STATE_ROOT"
  printf 'NODEACCESS_HA_PRIVATE_KEY_FILE=%q\n' "$PRIVATE_KEY_FILE"
  printf 'NODEACCESS_HA_PUBLIC_KEY_FILE=%q\n' "$PUBLIC_KEY_FILE"
  printf 'NODEACCESS_HA_PRIMARY_STORAGE_ROOT=%q\n' "${NODEACCESS_HA_PRIMARY_STORAGE_ROOT:-/srv/nodeaccess-replica}"
} > "$INSTALL_ROOT/agent.env"

install -m 700 /dev/null "$INSTALL_ROOT/report-health.sh"
cat > "$INSTALL_ROOT/report-health.sh" <<'AGENT'
#!/usr/bin/env bash
set -Eeuo pipefail
AGENT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$AGENT_ROOT/agent.env"

CURRENT_ROOT="${NODEACCESS_CURRENT_ROOT:-/opt/nodeaccess/current}"
docker_available=false
command -v docker >/dev/null 2>&1 && docker_available=true

json_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g' <<<"${1:-}" | tr -d '\r\n'
}

apply_shared_secrets() {
  local encrypted_dir="$NODEACCESS_HA_STATE_ROOT/encrypted-secrets"
  local decrypted_dir="$NODEACCESS_HA_STATE_ROOT/decrypted-secrets"
  local candidate="$NODEACCESS_HA_STATE_ROOT/shared.env.candidate"
  local backup="$NODEACCESS_HA_STATE_ROOT/shared.env.previous"
  local key encrypted value next
  local keys=(JWT_SECRET PEM_ENCRYPTION_KEY MYSQL_ROOT_PASSWORD MYSQL_PASSWORD MYSQL_REPLICATION_PASSWORD REDIS_PASSWORD)
  cleanup_secret_workdir() {
    rm -rf -- "$encrypted_dir" "$decrypted_dir"
    rm -f -- "$candidate" "${candidate}.next"
  }
  install -d -m 0700 "$encrypted_dir" "$decrypted_dir"
  [[ -f "$NODEACCESS_ENV_FILE" ]] || {
    result_message="Configuração bloqueada: arquivo .env de destino não existe."
    return 1
  }
  cp -p "$NODEACCESS_ENV_FILE" "$backup"
  cp -p "$NODEACCESS_ENV_FILE" "$candidate"
  for key in "${keys[@]}"; do
    encrypted="$(sed -n "s/.*\\\"$key\\\":\\\"\\([^\\\"]*\\)\\\".*/\\1/p" <<<"$claim_body")"
    [[ -n "$encrypted" ]] || {
      result_message="Envelope cifrado incompleto: $key ausente."
      cp -p "$backup" "$NODEACCESS_ENV_FILE"
      cleanup_secret_workdir
      return 1
    }
    printf '%s' "$encrypted" | base64 -d > "$encrypted_dir/$key.bin" 2>/dev/null || {
      result_message="Envelope cifrado inválido para $key."
      cp -p "$backup" "$NODEACCESS_ENV_FILE"
      cleanup_secret_workdir
      return 1
    }
    if ! openssl pkeyutl -decrypt -inkey "$NODEACCESS_HA_PRIVATE_KEY_FILE" \
      -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
      -in "$encrypted_dir/$key.bin" -out "$decrypted_dir/$key"; then
      result_message="Não foi possível decifrar $key com a chave local."
      cp -p "$backup" "$NODEACCESS_ENV_FILE"
      cleanup_secret_workdir
      return 1
    fi
    value="$(<"$decrypted_dir/$key")"
    if [[ -z "$value" || ${#value} -gt 240 || ! "$value" =~ ^[A-Za-z0-9_./+=:@%-]+$ ]]; then
      result_message="Valor decifrado inválido para $key."
      cp -p "$backup" "$NODEACCESS_ENV_FILE"
      cleanup_secret_workdir
      return 1
    fi
    next="${candidate}.next"
    awk -v target="$key" -v replacement="$value" '
      BEGIN { found = 0 }
      index($0, target "=") == 1 { print target "=" replacement; found = 1; next }
      { print }
      END { if (!found) print target "=" replacement }
    ' "$candidate" > "$next"
    mv "$next" "$candidate"
  done
  chmod 600 "$candidate"
  mv "$candidate" "$NODEACCESS_ENV_FILE"
  cleanup_secret_workdir
  result_message="Segredos compartilhados aplicados atomicamente; backup local preservado para rollback."
}

rollback_shared_secrets() {
  local backup="$NODEACCESS_HA_STATE_ROOT/shared.env.previous"
  local rollback_candidate="$NODEACCESS_HA_STATE_ROOT/shared.env.rollback"
  [[ -s "$backup" ]] || {
    result_message="Rollback indisponível: backup local da configuração não encontrado."
    return 1
  }
  cp -p "$backup" "$rollback_candidate"
  chmod 600 "$rollback_candidate"
  mv "$rollback_candidate" "$NODEACCESS_ENV_FILE"
  result_message="Configuração anterior restaurada atomicamente; serviços ainda não foram reiniciados."
}

prepare_storage_directories() {
  local storage_root="/srv/nodeaccess-replica"
  local marker="/opt/nodeaccess-ha-agent/provision-storage.created"
  local path
  local created=0
  touch "$marker"
  chmod 600 "$marker"
  for path in \
    "$storage_root" \
    "$storage_root/session-audit" \
    "$storage_root/user-avatars" \
    "$storage_root/backups"; do
    if [[ ! -e "$path" ]]; then
      mkdir "$path"
      chmod 750 "$path"
      printf '%s\n' "$path" >> "$marker"
      created=$((created + 1))
    elif [[ ! -d "$path" ]]; then
      result_message="Preparação bloqueada: $path existe e não é um diretório."
      return 1
    fi
  done
  result_message="Diretórios de dados verificados; $created diretório(s) criado(s) pelo agente."
}

rollback_storage_directories() {
  local marker="/opt/nodeaccess-ha-agent/provision-storage.created"
  local retained="${marker}.retained"
  local path
  local removed=0
  local blocked=0
  [[ -f "$marker" ]] || {
    result_message="Nenhum diretório criado pelo agente para reverter."
    return 0
  }
  : > "$retained"
  while IFS= read -r path; do
    case "$path" in
      /srv/nodeaccess-replica|/srv/nodeaccess-replica/session-audit|/srv/nodeaccess-replica/user-avatars|/srv/nodeaccess-replica/backups)
        if [[ ! -e "$path" ]]; then
          continue
        elif rmdir "$path" 2>/dev/null; then
          removed=$((removed + 1))
        else
          printf '%s\n' "$path" >> "$retained"
          blocked=$((blocked + 1))
        fi
        ;;
      *)
        printf '%s\n' "$path" >> "$retained"
        blocked=$((blocked + 1))
        ;;
    esac
  done < <(tac "$marker")
  tac "$retained" > "$marker"
  rm -f "$retained"
  if (( blocked > 0 )); then
    result_message="Rollback parcial: $removed diretório(s) vazio(s) removido(s); $blocked preservado(s) por conter dados ou não pertencer à lista permitida."
    return 1
  fi
  result_message="Rollback concluído; $removed diretório(s) vazio(s) criado(s) pelo agente removido(s)."
}

validate_storage_write_access() {
  local path
  local probe
  local validated=0
  for path in \
    /srv/nodeaccess-replica/session-audit \
    /srv/nodeaccess-replica/user-avatars \
    /srv/nodeaccess-replica/backups; do
    if [[ -L "$path" || ! -d "$path" ]]; then
      result_message="Validação bloqueada: $path está ausente ou é um link simbólico."
      return 1
    fi
    if ! probe="$(mktemp "$path/.nodeaccess-ha-write-probe.XXXXXX")"; then
      result_message="Sem permissão para criar probe temporário em $path."
      return 1
    fi
    chmod 600 "$probe"
    if ! printf 'nodeaccess-ha-write-probe\n' > "$probe" || ! rm -f "$probe"; then
      rm -f "$probe"
      result_message="Falha ao gravar ou remover probe temporário em $path."
      return 1
    fi
    validated=$((validated + 1))
  done
  result_message="Escrita temporária validada em $validated diretório(s); nenhum probe foi mantido."
}

install_release() {
  local release_url="$1"
  local expected_sha256="$2"
  local download_root="${NODEACCESS_HA_DOWNLOAD_ROOT:-${NODEACCESS_HA_STATE_ROOT:-/var/lib/nodeaccess-ha-agent}/downloads}"
  local deploy_root="${NODEACCESS_DEPLOY_ROOT:-/opt/nodeaccess}"
  local archive_path archive_root installer_path actual_sha256

  case "$release_url" in
    https://*|http://*) ;;
    *)
      result_message="URL da release recusada pelo catálogo local."
      return 1
      ;;
  esac
  if [[ "$release_url" == *[[:space:]]* || "$release_url" == *\\* || "$release_url" == *\"* ]]; then
    result_message="URL da release contém caracteres não permitidos."
    return 1
  fi
  [[ "$expected_sha256" =~ ^[a-fA-F0-9]{64}$ ]] || {
    result_message="SHA-256 da release é inválido."
    return 1
  }
  if [[ "$release_url" != https://* && "${NODEACCESS_HA_ALLOW_HTTP:-false}" != true ]]; then
    result_message="Download HTTP recusado; publique a release por HTTPS."
    return 1
  fi
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || {
    result_message="Docker Engine e Compose são obrigatórios antes de instalar a release."
    return 1
  }

  install -d -m 0700 "$download_root"
  archive_path="$(mktemp "$download_root/nodeaccess-release.XXXXXX.tar.gz")"
  if ! curl -fL --connect-timeout 15 --max-time 1800 --retry 2 \
    -o "$archive_path" "$release_url"; then
    rm -f "$archive_path"
    result_message="Falha ao baixar o pacote da release."
    return 1
  fi
  actual_sha256="$(sha256sum "$archive_path" | awk '{print $1}')"
  if [[ "${actual_sha256,,}" != "${expected_sha256,,}" ]]; then
    rm -f "$archive_path"
    result_message="Checksum da release diverge do SHA-256 aprovado."
    return 1
  fi
  archive_root="$(
    tar -tzf "$archive_path" |
      awk -F/ 'NR == 1 { root = $1 } $1 != root { invalid = 1 } END { if (!invalid) print root }'
  )"
  [[ "$archive_root" =~ ^nodeaccess-release-[0-9A-Za-z._-]+$ ]] || {
    rm -f "$archive_path"
    result_message="Estrutura interna do pacote da release é inválida."
    return 1
  }
  installer_path="$archive_root/scripts/deploy/install-from-tarball.sh"
  if ! tar -tzf "$archive_path" | grep -Fxq "$installer_path"; then
    rm -f "$archive_path"
    result_message="Instalador versionado ausente no pacote."
    return 1
  fi
  if ! RUN_INSTALL=false REPLACE_EXISTING_RELEASE=true DEPLOY_ROOT="$deploy_root" \
    bash <(tar -xOzf "$archive_path" "$installer_path") "$archive_path"; then
    rm -f "$archive_path"
    result_message="O instalador versionado não conseguiu promover a release."
    return 1
  fi
  rm -f "$archive_path"
  result_message="Release $archive_root validada, carregada e promovida; containers ainda não foram iniciados."
}

status_for_service() {
  local service="$1"
  [[ "$docker_available" == true ]] || { printf unknown; return; }
  if docker ps \
    --filter "label=com.docker.compose.project=nodeaccess" \
    --filter "label=com.docker.compose.service=$service" \
    --filter "status=running" \
    --format '{{.Names}}' 2>/dev/null | grep -q .; then
    printf ok
  else
    printf down
  fi
}

mysql_status=down
redis_status=down
files_status=unknown
mysql_lag_fragment=""
api_status=down
frontend_status="$(status_for_service frontend)"
gateway_status="$(status_for_service ssh-gateway)"
guacd_status="$(status_for_service guacd)"
observed_role="${NODEACCESS_HA_NODE_ROLE:-STANDBY}"
configured_role="$observed_role"
virtual_ip="${NODEACCESS_HA_VIRTUAL_IP:-}"
primary_storage_root="${NODEACCESS_HA_PRIMARY_STORAGE_ROOT:-/srv/nodeaccess-replica}"
owns_vip=false
if [[ -n "$virtual_ip" ]] && ip -4 address show | grep -Fq "$virtual_ip/"; then
  owns_vip=true
fi

# O papel observado vem do estado efetivo do banco/cache. O valor instalado no
# agente é apenas fallback durante bootstrap ou indisponibilidade do Docker.
mysql_read_only=""
redis_role=""
if [[ "$docker_available" == true ]]; then
  mysql_read_only="$(
    docker exec nodeaccess-state-mysql-1 sh -lc \
      'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names -e "SELECT @@GLOBAL.read_only;"' \
      2>/dev/null || true
  )"
  redis_role="$(docker exec nodeaccess-state-redis-1 redis-cli role 2>/dev/null | head -n 1 || true)"
  if [[ "$mysql_read_only" == 0 && "$redis_role" == master ]]; then
    observed_role=PRIMARY
  elif [[ "$mysql_read_only" == 1 && "$redis_role" == slave ]]; then
    observed_role=STANDBY
  fi
fi

if [[ "$docker_available" == true && "$observed_role" == "PRIMARY" ]]; then
  if docker exec nodeaccess-state-mysql-1 sh -lc \
    'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' \
    >/dev/null 2>&1; then
    mysql_status=ok
  fi
  if [[ "$(docker exec nodeaccess-state-redis-1 redis-cli role 2>/dev/null | head -n 1)" == master ]]; then
    redis_status=ok
  fi
  files_status=ok
  for storage_name in session-audit user-avatars backups; do
    [[ -d "$primary_storage_root/$storage_name" ]] || files_status=down
  done
elif [[ "$docker_available" == true && -x "$CURRENT_ROOT/scripts/deploy/ha-state-replication-status.sh" ]]; then
  if mysql_report="$(
    ENV_FILE="$NODEACCESS_ENV_FILE" CHECK_COMPONENT=mysql OUTPUT_FORMAT=json \
      bash "$CURRENT_ROOT/scripts/deploy/ha-state-replication-status.sh" 2>/dev/null
  )"; then
    mysql_status=ok
    mysql_lag="$(
      sed -n 's/.*"lagSeconds":\([0-9][0-9]*\).*/\1/p' <<<"$mysql_report" | head -n 1
    )"
    [[ -z "$mysql_lag" ]] || mysql_lag_fragment=",\"lagSeconds\":$mysql_lag"
  fi
fi
if [[ "$docker_available" == true && "$observed_role" == "STANDBY" && -x "$CURRENT_ROOT/scripts/deploy/ha-state-replication-status.sh" ]]; then
  if ENV_FILE="$NODEACCESS_ENV_FILE" CHECK_COMPONENT=redis OUTPUT_FORMAT=json \
    bash "$CURRENT_ROOT/scripts/deploy/ha-state-replication-status.sh" >/dev/null 2>&1; then
    redis_status=ok
  fi
fi
file_replica_root="/srv/nodeaccess-replica"
if [[ "$observed_role" == "STANDBY" && -f /etc/sysconfig/nodeaccess-ha-file-sync ]]; then
  configured_replica_root="$(
    awk -F= '$1 == "REPLICA_ROOT" { print substr($0, index($0, "=") + 1); exit }' \
      /etc/sysconfig/nodeaccess-ha-file-sync
  )"
  [[ -z "$configured_replica_root" ]] || file_replica_root="$configured_replica_root"
fi
if [[ "$observed_role" == "STANDBY" && -x "$CURRENT_ROOT/scripts/deploy/ha-file-replica-status.sh" ]] &&
   REPLICA_ROOT="$file_replica_root" REQUIRE_SOURCE_MATCH=false \
     bash "$CURRENT_ROOT/scripts/deploy/ha-file-replica-status.sh" >/dev/null 2>&1; then
  files_status=ok
fi
if curl -fsS --max-time 5 http://127.0.0.1:3000/health/deep >/dev/null 2>&1; then
  api_status=ok
fi

keepalived_status=down
if systemctl is-active --quiet keepalived 2>/dev/null; then
  keepalived_status=ok
fi
orchestration_status=ok
orchestration_message="Topologia estável."
if [[ -f /opt/nodeaccess/shared/ha/primary-quiesced ]]; then
  orchestration_status=degraded
  orchestration_message="Troca em andamento: origem congelada, somente leitura e sem a VIP."
elif [[ "$configured_role" != "$observed_role" ]]; then
  orchestration_status=degraded
  orchestration_message="Mudança de papel detectada; aguardando persistência da nova topologia."
elif [[ "$keepalived_status" != ok ]]; then
  orchestration_status=degraded
  orchestration_message="Keepalived interrompido; a VIP pode estar sendo direcionada durante uma operação controlada."
fi
orchestration_message="$(json_escape "$orchestration_message")"

auto_failover_status=unknown
auto_failover_message="Failover automático ainda não configurado neste nó."
auto_failover_config="${NODEACCESS_HA_AUTO_FAILOVER_CONFIG:-/etc/sysconfig/nodeaccess-ha-autofailover}"
if [[ -r "$auto_failover_config" ]]; then
  AUTO_FAILOVER_ENABLED=false
  AUTO_FAILOVER_MODE=observe-only
  WITNESS_URL=""
  FAILURE_THRESHOLD=6
  source "$auto_failover_config"
  consecutive_failures=0
  counter_file="$NODEACCESS_HA_STATE_ROOT/auto-failover/consecutive-failures"
  [[ -r "$counter_file" ]] && consecutive_failures="$(<"$counter_file")"
  [[ "$consecutive_failures" =~ ^[0-9]+$ ]] || consecutive_failures=0
  witness_health=down
  if [[ -n "$WITNESS_URL" ]] &&
     curl -fsS --connect-timeout 2 --max-time 3 "${WITNESS_URL%/}/health" >/dev/null 2>&1; then
    witness_health=ok
  fi
  timer_health=down
  systemctl is-active --quiet nodeaccess-ha-auto-failover.timer 2>/dev/null && timer_health=ok
  if [[ "$AUTO_FAILOVER_ENABLED" == true && "$timer_health" == ok && "$witness_health" == ok ]]; then
    auto_failover_status=ok
  else
    auto_failover_status=degraded
  fi
  auto_failover_message="Modo ${AUTO_FAILOVER_MODE}; timer ${timer_health}; witness ${witness_health}; falhas consecutivas ${consecutive_failures}/${FAILURE_THRESHOLD}."
fi
auto_failover_message="$(json_escape "$auto_failover_message")"

hostname_value="$(json_escape "$(hostname 2>/dev/null || printf unknown)")"
operating_system="Linux"
if [[ -r /etc/os-release ]]; then
  operating_system="$(. /etc/os-release; printf '%s' "${PRETTY_NAME:-Linux}")"
fi
operating_system="$(json_escape "$operating_system")"
architecture="$(json_escape "$(uname -m 2>/dev/null || printf unknown)")"
cpu_cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 1)"
memory_total_mb="$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null)"
disk_free_mb="$(df -Pm / 2>/dev/null | awk 'NR == 2 { print $4 }')"
[[ "$cpu_cores" =~ ^[0-9]+$ ]] || cpu_cores=1
[[ "$memory_total_mb" =~ ^[0-9]+$ ]] || memory_total_mb=1
[[ "$disk_free_mb" =~ ^[0-9]+$ ]] || disk_free_mb=0
docker_installed=false
compose_installed=false
docker_version=""
if [[ "$docker_available" == true ]]; then
  docker_installed=true
  docker_version="$(json_escape "$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)")"
  docker compose version >/dev/null 2>&1 && compose_installed=true
fi

encryption_public_key_base64="$(base64 -w 0 "$NODEACCESS_HA_PUBLIC_KEY_FILE")"
payload=$(printf '{"observedRole":"%s","ownsVip":%s,"virtualIp":"%s","encryptionPublicKeyBase64":"%s","components":{"mysql":{"status":"%s"%s},"redis":{"status":"%s"},"files":{"status":"%s"},"api":{"status":"%s"},"frontend":{"status":"%s"},"sshGateway":{"status":"%s"},"guacd":{"status":"%s"},"keepalived":{"status":"%s"},"orchestration":{"status":"%s","message":"%s"},"autoFailover":{"status":"%s","message":"%s"}},"inventory":{"hostname":"%s","operatingSystem":"%s","architecture":"%s","cpuCores":%s,"memoryTotalMb":%s,"diskFreeMb":%s,"dockerInstalled":%s,"dockerVersion":"%s","composeInstalled":%s}}' \
  "$observed_role" "$owns_vip" "$virtual_ip" "$encryption_public_key_base64" "$mysql_status" "$mysql_lag_fragment" "$redis_status" "$files_status" "$api_status" "$frontend_status" "$gateway_status" "$guacd_status" "$keepalived_status" "$orchestration_status" "$orchestration_message" "$auto_failover_status" "$auto_failover_message" \
  "$hostname_value" "$operating_system" "$architecture" "$cpu_cores" "$memory_total_mb" "$disk_free_mb" "$docker_installed" "$docker_version" "$compose_installed")

curl -fsS --max-time 15 \
  -H "Authorization: Bearer $NODEACCESS_HA_ENROLLMENT_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$payload" \
  "$NODEACCESS_HA_API_URL/ha/agent/nodes/$NODEACCESS_HA_NODE_ID/report" >/dev/null

claim_response="$(
  curl -sS --max-time 15 \
    -w '\n%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $NODEACCESS_HA_ENROLLMENT_TOKEN" \
    "$NODEACCESS_HA_API_URL/ha/agent/nodes/$NODEACCESS_HA_NODE_ID/jobs/claim"
)"
claim_status="$(tail -n 1 <<<"$claim_response")"
claim_body="$(sed '$d' <<<"$claim_response")"
if [[ "$claim_status" == 200 ]]; then
  job_id="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  action="$(sed -n 's/.*"action":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  lease_token="$(sed -n 's/.*"leaseToken":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  completion_base_url="$(sed -n 's/.*"completionBaseUrl":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  release_url="$(sed -n 's/.*"releaseUrl":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  release_sha256="$(sed -n 's/.*"sha256":"\([a-fA-F0-9]*\)".*/\1/p' <<<"$claim_body")"
  operation_id="$(sed -n 's/.*"operationId":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  virtual_ip_param="$(sed -n 's/.*"virtualIp":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  primary_node_id="$(sed -n 's/.*"primaryNodeId":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  standby_node_id="$(sed -n 's/.*"standbyNodeId":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  primary_node_ip="$(sed -n 's/.*"primaryNodeIp":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  standby_node_ip="$(sed -n 's/.*"standbyNodeIp":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  witness_evidence_file="$(sed -n 's/.*"witnessEvidenceFile":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  witness_signature_file="$(sed -n 's/.*"witnessSignatureFile":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  witness_public_key="$(sed -n 's/.*"witnessPublicKey":"\([^"]*\)".*/\1/p' <<<"$claim_body")"
  success=false
  result_message="Ação não reconhecida pelo catálogo local do agente."
  if [[ "$action" == REFRESH_INVENTORY ]]; then
    success=true
    result_message="Inventário atualizado e contrato do executor validado."
  elif [[ "$action" == PREPARE_STORAGE_DIRECTORIES ]]; then
    if [[ "$observed_role" != STANDBY || "$owns_vip" == true ]]; then
      result_message="Ação recusada localmente: o nó precisa ser STANDBY e não possuir a VIP."
    elif prepare_storage_directories; then
      success=true
    fi
  elif [[ "$action" == ROLLBACK_STORAGE_DIRECTORIES ]]; then
    if [[ "$observed_role" != STANDBY || "$owns_vip" == true ]]; then
      result_message="Ação recusada localmente: o nó precisa ser STANDBY e não possuir a VIP."
    elif rollback_storage_directories; then
      success=true
    fi
  elif [[ "$action" == VALIDATE_STORAGE_WRITE_ACCESS ]]; then
    if [[ "$observed_role" != STANDBY || "$owns_vip" == true ]]; then
      result_message="Ação recusada localmente: o nó precisa ser STANDBY e não possuir a VIP."
    elif validate_storage_write_access; then
      success=true
    fi
  elif [[ "$action" == INSTALL_RELEASE ]]; then
    if [[ "$observed_role" != STANDBY || "$owns_vip" == true ]]; then
      result_message="Ação recusada localmente: o nó precisa ser STANDBY e não possuir a VIP."
    elif install_release "$release_url" "$release_sha256"; then
      success=true
    fi
  elif [[ "$action" == APPLY_SHARED_SECRETS ]]; then
    if [[ "$observed_role" != STANDBY || "$owns_vip" == true ]]; then
      result_message="Ação recusada localmente: o nó precisa ser STANDBY e não possuir a VIP."
    elif apply_shared_secrets; then
      success=true
    fi
  elif [[ "$action" == ROLLBACK_SHARED_SECRETS ]]; then
    if [[ "$observed_role" != STANDBY || "$owns_vip" == true ]]; then
      result_message="Ação recusada localmente: o nó precisa ser STANDBY e não possuir a VIP."
    elif rollback_shared_secrets; then
      success=true
    fi
  elif [[ "$action" == ARM_PROMOTION ]]; then
    if [[ "$observed_role" != STANDBY || "$owns_vip" == true ]]; then
      result_message="Arme recusado localmente: o nó precisa ser STANDBY e não possuir a VIP."
    elif ! MODE=check \
      ACTIVE_NODE_IP="$primary_node_ip" \
      ENV_FILE="$NODEACCESS_ENV_FILE" \
      REPORT_PATH="$NODEACCESS_HA_STATE_ROOT/arm-promotion-readiness.json" \
      bash "$CURRENT_ROOT/scripts/deploy/prepare-ha-rejoin.sh" >/dev/null 2>&1; then
      result_message="Arme recusado localmente: a paridade final preliminar de estado ou arquivos falhou."
    elif OPERATION_ID="$operation_id" \
      VIRTUAL_IP="$virtual_ip_param" \
      PRIMARY_NODE_ID="$primary_node_id" \
      STANDBY_NODE_ID="$standby_node_id" \
      NODE_IP="$standby_node_ip" \
      FINAL_SYNC_SOURCE_IP="$primary_node_ip" \
      WITNESS_EVIDENCE_FILE="$witness_evidence_file" \
      WITNESS_SIGNATURE_FILE="$witness_signature_file" \
      WITNESS_PUBLIC_KEY="$witness_public_key" \
      "$AGENT_ROOT/privileged-helper.sh" schedule-promote-standby; then
      success=true
      result_message="Promoção persistida localmente; o primário já pode ser congelado."
    fi
  elif [[ "$action" == QUIESCE_PRIMARY ]]; then
    if [[ "$observed_role" != PRIMARY || "$owns_vip" != true ]]; then
      result_message="Quiesce recusado localmente: o nó precisa ser PRIMARY e possuir a VIP."
    elif OPERATION_ID="$operation_id" VIRTUAL_IP="$virtual_ip_param" \
      "$AGENT_ROOT/privileged-helper.sh" schedule-quiesce-primary; then
      success=true
      result_message="Quiesce armado localmente; a promoção permanece bloqueada até a origem ficar somente leitura e a VIP sair do ar."
    fi
  elif [[ "$action" == PROMOTE_STANDBY ]]; then
    if [[ "$observed_role" != STANDBY || "$owns_vip" == true ]]; then
      result_message="Promoção recusada localmente: o nó precisa ser STANDBY e não possuir a VIP."
    elif OPERATION_ID="$operation_id" \
      VIRTUAL_IP="$virtual_ip_param" \
      PRIMARY_NODE_ID="$primary_node_id" \
      STANDBY_NODE_ID="$standby_node_id" \
      NODE_IP="$standby_node_ip" \
      FINAL_SYNC_SOURCE_IP="$primary_node_ip" \
      WITNESS_EVIDENCE_FILE="$witness_evidence_file" \
      WITNESS_SIGNATURE_FILE="$witness_signature_file" \
      WITNESS_PUBLIC_KEY="$witness_public_key" \
      "$AGENT_ROOT/privileged-helper.sh" promote-standby; then
      success=true
      result_message="Standby promovido; valide a topologia e reconcilie os papéis."
    fi
  fi
  result_message="$(json_escape "$result_message")"
  completion_payload="$(printf '{"leaseToken":"%s","success":%s,"message":"%s"}' \
    "$lease_token" "$success" "$result_message")"
  completion_path="/ha/agent/nodes/$NODEACCESS_HA_NODE_ID/jobs/$job_id/complete"
  if ! curl -fsS --max-time 15 \
    -X POST \
    -H "Authorization: Bearer $NODEACCESS_HA_ENROLLMENT_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$completion_payload" \
    "$NODEACCESS_HA_API_URL$completion_path" >/dev/null; then
    if [[ ! "$completion_base_url" =~ ^https://[A-Za-z0-9.-]+/api/v1$ ]]; then
      echo "[nodeaccess-ha-agent] Falha ao concluir job pela VIP e callback direto indisponível." >&2
      exit 1
    fi
    curl -fsS --max-time 15 \
      -X POST \
      -H "Authorization: Bearer $NODEACCESS_HA_ENROLLMENT_TOKEN" \
      -H "Content-Type: application/json" \
      --data "$completion_payload" \
      "$completion_base_url$completion_path" >/dev/null
  fi
elif [[ "$claim_status" != 204 ]]; then
  echo "[nodeaccess-ha-agent] Falha ao consultar fila governada: HTTP $claim_status" >&2
  exit 1
fi
AGENT

cat > "$SYSTEMD_UNIT_DIR/nodeaccess-ha-agent.service" <<UNIT
[Unit]
Description=NodeAccess HA health and replication reporter
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$INSTALL_ROOT/report-health.sh
User=root
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadOnlyPaths=/var/lib/docker
ReadWritePaths=$INSTALL_ROOT $DEPLOY_ROOT $AGENT_STATE_ROOT /srv -/etc/keepalived -/etc/sysconfig/nodeaccess-ha-file-sync
UNIT

cat > "$SYSTEMD_UNIT_DIR/nodeaccess-ha-agent.timer" <<'UNIT'
[Unit]
Description=Run NodeAccess HA reporter every 30 seconds

[Timer]
OnActiveSec=10
OnUnitInactiveSec=30
AccuracySec=5
Persistent=true

[Install]
WantedBy=timers.target
UNIT

auto_failover_installed=false
auto_failover_service="$RELEASE_ROOT/systemd/nodeaccess-ha-auto-failover.service"
auto_failover_timer="$RELEASE_ROOT/systemd/nodeaccess-ha-auto-failover.timer"
auto_failover_watcher="$RELEASE_ROOT/scripts/deploy/ha-auto-failover-watch.sh"
if [[ -r "$auto_failover_service" && -r "$auto_failover_timer" && -x "$auto_failover_watcher" ]]; then
  install -o root -g root -m 0644 \
    "$auto_failover_service" "$SYSTEMD_UNIT_DIR/nodeaccess-ha-auto-failover.service"
  install -o root -g root -m 0644 \
    "$auto_failover_timer" "$SYSTEMD_UNIT_DIR/nodeaccess-ha-auto-failover.timer"
  auto_failover_installed=true
fi

systemctl daemon-reload
systemctl enable --now nodeaccess-ha-agent.timer
systemctl start nodeaccess-ha-agent.service
if [[ "$auto_failover_installed" == true ]]; then
  systemctl enable --now nodeaccess-ha-auto-failover.timer
fi
echo "[nodeaccess-ha-agent] Instalado. O no enviara checks a cada 30 segundos."
if [[ "$auto_failover_installed" == true ]]; then
  echo "[nodeaccess-ha-agent] Observador de failover instalado; sem configuração root-only válida ele permanece inerte."
else
  echo "[nodeaccess-ha-agent] Observador de failover não instalado: componentes ausentes na release atual."
fi
