#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$ROOT/scripts/deploy/install-ha-agent.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/install" "$TMP/systemd"
mkdir -p "$TMP/current/scripts/deploy" "$TMP/current/systemd"
cp "$ROOT/scripts/deploy/ha-auto-failover-watch.sh" "$TMP/current/scripts/deploy/"
cp "$ROOT/systemd/nodeaccess-ha-auto-failover.service" "$TMP/current/systemd/"
cp "$ROOT/systemd/nodeaccess-ha-auto-failover.timer" "$TMP/current/systemd/"
chmod +x "$TMP/current/scripts/deploy/ha-auto-failover-watch.sh"

cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${CURL_LOG:?}"
if [[ "$*" == *"/ha/agent/privileged-helper.sh"* ]]; then
  cp "${HELPER_SOURCE:?}" /dev/stdout
  exit 0
fi
if [[ "$*" == *"release-download.test"* ]]; then
  args=("$@")
  for ((index = 0; index < ${#args[@]}; index++)); do
    if [[ "${args[$index]}" == "-o" ]]; then
      cp "${RELEASE_SOURCE:?}" "${args[$((index + 1))]}"
      exit 0
    fi
  done
fi
if [[ "$*" == *"/jobs/claim"* ]]; then
  if [[ -n "${CLAIM_BODY:-}" ]]; then
    printf '%s\n200' "$CLAIM_BODY"
    exit 0
  fi
  printf '\n204'
fi
if [[ "${FAIL_PRIMARY_COMPLETION:-false}" == true
  && "$*" == *"https://nodeaccess.test/api/v1/ha/agent/nodes/"*
  && "$*" == *"/complete"* ]]; then
  exit 22
fi
EOF
cat > "$TMP/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${SYSTEMCTL_LOG:?}"
EOF
cat > "$TMP/bin/ip" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$TMP/bin/hostname" <<'EOF'
#!/usr/bin/env bash
printf 'ha-agent-harness\n'
EOF
chmod +x "$TMP/bin/"*
printf 'JWT_SECRET=harness\n' > "$TMP/nodeaccess.env"

echo "[nodeaccess] Cenário 1/8: VIP explícita é obrigatória..."
if env PATH="$TMP/bin:$PATH" CURL_LOG="$TMP/curl.log" \
  HELPER_SOURCE="$ROOT/scripts/deploy/nodeaccess-ha-privileged-helper.sh" \
  NODEACCESS_HA_AGENT_ROOT="$TMP/install" \
  NODEACCESS_HA_SYSTEMD_UNIT_DIR="$TMP/systemd" \
  NODEACCESS_DEPLOY_ROOT="$TMP/deploy" \
  NODEACCESS_HA_STATE_ROOT="$TMP/state" \
  NODEACCESS_HA_ENROLLMENT_TOKEN=harness-token \
  bash "$TARGET" --api-url https://nodeaccess.test/api/v1 \
    --node-id 11111111-1111-1111-1111-111111111111 >/dev/null 2>&1; then
  echo "[fail] Instalador aceitou matrícula sem VIP explícita." >&2
  exit 1
fi

echo "[nodeaccess] Cenário 2/8: HTTPS obrigatório fora de POC..."
if env PATH="$TMP/bin:$PATH" CURL_LOG="$TMP/curl.log" \
  HELPER_SOURCE="$ROOT/scripts/deploy/nodeaccess-ha-privileged-helper.sh" \
  NODEACCESS_HA_AGENT_ROOT="$TMP/install" \
  NODEACCESS_HA_SYSTEMD_UNIT_DIR="$TMP/systemd" \
  NODEACCESS_DEPLOY_ROOT="$TMP/deploy" \
  NODEACCESS_HA_STATE_ROOT="$TMP/state" \
  NODEACCESS_HA_ENROLLMENT_TOKEN=harness-token \
  bash "$TARGET" --api-url http://nodeaccess.test/api/v1 \
    --node-id 11111111-1111-1111-1111-111111111111 >/dev/null 2>&1; then
  echo "[fail] Instalador aceitou HTTP sem opt-in." >&2
  exit 1
fi

echo "[nodeaccess] Cenário 3/8: instalação isolada gera contrato completo..."
env PATH="$TMP/bin:$PATH" CURL_LOG="$TMP/curl.log" \
  HELPER_SOURCE="$ROOT/scripts/deploy/nodeaccess-ha-privileged-helper.sh" \
  SYSTEMCTL_LOG="$TMP/systemctl.log" \
  NODEACCESS_HA_AGENT_ROOT="$TMP/install" \
  NODEACCESS_HA_SYSTEMD_UNIT_DIR="$TMP/systemd" \
  NODEACCESS_DEPLOY_ROOT="$TMP/deploy" \
  NODEACCESS_HA_STATE_ROOT="$TMP/state" \
  NODEACCESS_HA_RELEASE_ROOT="$TMP/current" \
  NODEACCESS_ENV_FILE="$TMP/nodeaccess.env" \
  NODEACCESS_HA_ENROLLMENT_TOKEN=harness-token \
  bash "$TARGET" --api-url https://nodeaccess.test/api/v1 \
    --node-id 11111111-1111-1111-1111-111111111111 \
    --role STANDBY --virtual-ip 192.0.2.105

[[ "$(stat -c '%a' "$TMP/install")" == 700 ]]
[[ "$(stat -c '%a' "$TMP/install/agent.env")" == 600 ]]
[[ "$(stat -c '%a' "$TMP/install/report-health.sh")" == 700 ]]
[[ "$(stat -c '%a' "$TMP/install/privileged-helper.sh")" == 700 ]]
grep -Fq 'source "$AGENT_ROOT/agent.env"' "$TMP/install/report-health.sh"
grep -Fq 'NODEACCESS_HA_VIRTUAL_IP=192.0.2.105' "$TMP/install/agent.env"
grep -Fq "ExecStart=$TMP/install/report-health.sh" "$TMP/systemd/nodeaccess-ha-agent.service"
grep -Fq "ReadWritePaths=$TMP/install $TMP/deploy $TMP/state /srv -/etc/keepalived -/etc/sysconfig/nodeaccess-ha-file-sync" "$TMP/systemd/nodeaccess-ha-agent.service"
grep -Fq 'OnActiveSec=10' "$TMP/systemd/nodeaccess-ha-agent.timer"
grep -Fq 'OnUnitInactiveSec=30' "$TMP/systemd/nodeaccess-ha-agent.timer"
grep -Fq 'SELECT @@GLOBAL.read_only' "$TMP/install/report-health.sh"
grep -Fq '"$action" == ARM_PROMOTION' "$TMP/install/report-health.sh"
grep -Fq 'ACTIVE_NODE_IP="$primary_node_ip"' "$TMP/install/report-health.sh"
grep -Fq 'arm-promotion-readiness.json' "$TMP/install/report-health.sh"
grep -Fq 'schedule-promote-standby' "$TMP/install/report-health.sh"
grep -Fq '"keepalived":{"status":"%s"}' "$TMP/install/report-health.sh"
grep -Fq '"orchestration":{"status":"%s","message":"%s"}' "$TMP/install/report-health.sh"
grep -Fq '"autoFailover":{"status":"%s","message":"%s"}' "$TMP/install/report-health.sh"
if grep -Fq 'OnUnitActiveSec=' "$TMP/systemd/nodeaccess-ha-agent.timer"; then
  echo "[fail] Timer ainda depende do último estado ativo do oneshot." >&2
  exit 1
fi
grep -Fq 'enable --now nodeaccess-ha-agent.timer' "$TMP/systemctl.log"
grep -Fq 'start nodeaccess-ha-agent.service' "$TMP/systemctl.log"
grep -Fq 'ha-auto-failover-watch.sh' "$TMP/systemd/nodeaccess-ha-auto-failover.service"
grep -Fq 'OnUnitActiveSec=5s' "$TMP/systemd/nodeaccess-ha-auto-failover.timer"
grep -Fq 'enable --now nodeaccess-ha-auto-failover.timer' "$TMP/systemctl.log"

echo "[nodeaccess] Cenário 4/8: helper rejeita ações e caminhos fora do catálogo..."
if bash "$TMP/install/privileged-helper.sh" arbitrary-action >/dev/null 2>&1; then
  echo "[fail] Helper aceitou ação fora do catálogo." >&2
  exit 1
fi
if env \
  OPERATION_ID=switchover-harness \
  PRIMARY_NODE_ID=primary-node \
  STANDBY_NODE_ID=standby-node \
  NODE_IP=192.0.2.11 \
  FINAL_SYNC_SOURCE_IP=192.0.2.10 \
  VIRTUAL_IP=192.0.2.105 \
  WITNESS_EVIDENCE_FILE="$TMP/witness.txt" \
  WITNESS_SIGNATURE_FILE="$TMP/witness.sig" \
  WITNESS_PUBLIC_KEY="$TMP/witness.pem" \
  bash "$TMP/install/privileged-helper.sh" promote-standby >/dev/null 2>&1; then
  echo "[fail] Helper aceitou arquivos witness fora do diretório permitido." >&2
  exit 1
fi

echo "[nodeaccess] Cenário 5/8: reporter envia heartbeat e consulta fila..."
: > "$TMP/curl.log"
env PATH="$TMP/bin:$PATH" CURL_LOG="$TMP/curl.log" \
  NODEACCESS_CURRENT_ROOT="$TMP/current" \
  bash "$TMP/install/report-health.sh"
grep -Fq '/ha/agent/nodes/11111111-1111-1111-1111-111111111111/report' "$TMP/curl.log"
grep -Fq '/ha/agent/nodes/11111111-1111-1111-1111-111111111111/jobs/claim' "$TMP/curl.log"

echo "[nodeaccess] Cenário 6/8: release exige checksum e é promovida sem iniciar a stack..."
fixture_root="$TMP/release/nodeaccess-release-9.9.9"
mkdir -p "$fixture_root/scripts/deploy"
cat > "$fixture_root/scripts/deploy/install-from-tarball.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "${DEPLOY_ROOT:?}"
printf '%s\n' "$RUN_INSTALL" > "$DEPLOY_ROOT/run-install"
printf '%s\n' "$1" > "$DEPLOY_ROOT/archive"
EOF
tar -czf "$TMP/nodeaccess-release-9.9.9.tar.gz" -C "$TMP/release" nodeaccess-release-9.9.9
release_sha="$(sha256sum "$TMP/nodeaccess-release-9.9.9.tar.gz" | awk '{print $1}')"
: > "$TMP/curl.log"
claim_body="{\"id\":\"job-1\",\"operationId\":\"operation-1\",\"action\":\"INSTALL_RELEASE\",\"leaseToken\":\"lease-token-with-more-than-20-characters\",\"completionBaseUrl\":\"https://192.0.2.11/api/v1\",\"params\":{\"releaseUrl\":\"https://release-download.test/nodeaccess.tar.gz\",\"sha256\":\"$release_sha\"}}"
env PATH="$TMP/bin:$PATH" CURL_LOG="$TMP/curl.log" \
  FAIL_PRIMARY_COMPLETION=true \
  CLAIM_BODY="$claim_body" RELEASE_SOURCE="$TMP/nodeaccess-release-9.9.9.tar.gz" \
  NODEACCESS_HA_DOWNLOAD_ROOT="$TMP/downloads" NODEACCESS_DEPLOY_ROOT="$TMP/deploy" \
  NODEACCESS_CURRENT_ROOT="$TMP/current" \
  bash "$TMP/install/report-health.sh"
[[ "$(cat "$TMP/deploy/run-install")" == false ]]
grep -Fq '"success":true' "$TMP/curl.log"
grep -Fq '/jobs/job-1/complete' "$TMP/curl.log"
grep -Fq 'https://192.0.2.11/api/v1/ha/agent/nodes/' "$TMP/curl.log"

echo "[nodeaccess] Cenário 7/8: segredos são decifrados localmente e aplicados com backup..."
declare -A secret_values=(
  [JWT_SECRET]="jwt-secure-harness"
  [PEM_ENCRYPTION_KEY]="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  [MYSQL_ROOT_PASSWORD]="mysql-root-harness"
  [MYSQL_PASSWORD]="mysql-app-harness"
  [MYSQL_REPLICATION_PASSWORD]="mysql-replication-harness"
  [REDIS_PASSWORD]="redis-harness"
)
encrypted_params=""
for key in JWT_SECRET PEM_ENCRYPTION_KEY MYSQL_ROOT_PASSWORD MYSQL_PASSWORD MYSQL_REPLICATION_PASSWORD REDIS_PASSWORD; do
  printf '%s' "${secret_values[$key]}" > "$TMP/plain-$key"
  openssl pkeyutl -encrypt -pubin -inkey "$TMP/state/provisioning-public.pem" \
    -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
    -in "$TMP/plain-$key" -out "$TMP/encrypted-$key"
  encrypted_value="$(base64 -w 0 "$TMP/encrypted-$key")"
  [[ -z "$encrypted_params" ]] || encrypted_params+=","
  encrypted_params+="\"$key\":\"$encrypted_value\""
done
printf 'JWT_SECRET=before-action\nUNCHANGED=value\n' > "$TMP/nodeaccess.env"
: > "$TMP/curl.log"
claim_body="{\"id\":\"job-2\",\"operationId\":\"operation-2\",\"action\":\"APPLY_SHARED_SECRETS\",\"leaseToken\":\"lease-token-with-more-than-20-characters\",\"params\":{$encrypted_params}}"
env PATH="$TMP/bin:$PATH" CURL_LOG="$TMP/curl.log" CLAIM_BODY="$claim_body" \
  NODEACCESS_CURRENT_ROOT="$TMP/current" \
  bash "$TMP/install/report-health.sh"
for key in "${!secret_values[@]}"; do
  grep -Fqx "$key=${secret_values[$key]}" "$TMP/nodeaccess.env"
done
grep -Fqx 'JWT_SECRET=before-action' "$TMP/state/shared.env.previous"
grep -Fqx 'UNCHANGED=value' "$TMP/nodeaccess.env"
[[ ! -d "$TMP/state/encrypted-secrets" ]]
[[ ! -d "$TMP/state/decrypted-secrets" ]]
grep -Fq '"success":true' "$TMP/curl.log"
grep -Fq '/jobs/job-2/complete' "$TMP/curl.log"

echo "[nodeaccess] Cenário 8/8: rollback restaura atomicamente a configuração anterior..."
: > "$TMP/curl.log"
claim_body='{"id":"job-3","operationId":"operation-3","action":"ROLLBACK_SHARED_SECRETS","leaseToken":"lease-token-with-more-than-20-characters","params":{}}'
env PATH="$TMP/bin:$PATH" CURL_LOG="$TMP/curl.log" CLAIM_BODY="$claim_body" \
  NODEACCESS_CURRENT_ROOT="$TMP/current" \
  bash "$TMP/install/report-health.sh"
grep -Fqx 'JWT_SECRET=before-action' "$TMP/nodeaccess.env"
grep -Fqx 'UNCHANGED=value' "$TMP/nodeaccess.env"
grep -Fq '"success":true' "$TMP/curl.log"
grep -Fq '/jobs/job-3/complete' "$TMP/curl.log"

echo "[ok] Harness de instalação do agente HA passou."
