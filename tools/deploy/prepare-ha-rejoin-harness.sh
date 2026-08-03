#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TARGET_SCRIPT="${PROJECT_ROOT}/scripts/deploy/prepare-ha-rejoin.sh"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

FAKE_BIN="${TMP_ROOT}/bin"
mkdir -p "$FAKE_BIN" "${TMP_ROOT}/mysql"
mkdir -p "${TMP_ROOT}/current/scripts" "${TMP_ROOT}/current/systemd" \
  "${TMP_ROOT}/stable" "${TMP_ROOT}/systemd"
printf 'services:\n  redis:\n    image: redis:7-alpine\n' > "${TMP_ROOT}/state-compose.yml"

cat > "${FAKE_BIN}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG:?}"
if [[ "$*" == compose* ]]; then
  printf 'REDIS_REPLICA_HOST=%s REDIS_REPLICA_PORT=%s\n' \
    "${REDIS_REPLICA_HOST:-}" "${REDIS_REPLICA_PORT:-}" >> "${FAKE_DOCKER_LOG:?}"
fi
arguments="$*"
if [[ "$arguments" == *"GTID_SUBTRACT("* ]]; then
  if [[ "${FAKE_ERRANT_GTID:-false}" == "true" ]]; then
    printf 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:2\n'
  elif [[ "${FAKE_SOURCE_AHEAD:-false}" == "true" &&
          "$arguments" == *"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:1-12"*"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:1-10"* ]]; then
    printf 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:11-12\n'
  fi
elif [[ "$arguments" == *"@@GLOBAL.gtid_executed"* ]]; then
  if [[ "$arguments" == *" -h"* && "${FAKE_SOURCE_AHEAD:-false}" == "true" ]]; then
    printf 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:1-12\n'
  else
    printf 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:1-10\n'
  fi
elif [[ "$arguments" == *"inspect harness-redis"* ]]; then
  printf 'harness-redis-volume\n'
fi
EOF

cat > "${FAKE_BIN}/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_SYSTEMCTL_LOG:?}"
EOF

cat > "${FAKE_BIN}/ip" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '2: eth0    inet 192.0.2.10/24 scope global eth0\n'
EOF

cat > "${TMP_ROOT}/state-ok.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF

cat > "${TMP_ROOT}/file-ok.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF

chmod +x "${FAKE_BIN}/docker" "${FAKE_BIN}/systemctl" "${FAKE_BIN}/ip" \
  "${TMP_ROOT}/state-ok.sh" "${TMP_ROOT}/file-ok.sh"

cat > "${TMP_ROOT}/nodeaccess.env" <<'EOF'
DB_ROOT_PASSWORD=harness-root
SESSION_AUDIT_HOST_DIR=/srv/harness-data/session-audit
EOF
cat > "${TMP_ROOT}/replication.env" <<'EOF'
MYSQL_REPLICATION_USER=nodeaccess_repl
MYSQL_REPLICATION_PASSWORD=harness-repl
EOF
printf '[mysqld]\nserver-id=1\nread_only=ON\nsuper_read_only=ON\n' \
  > "${TMP_ROOT}/replica.cnf"
printf 'fake-key\n' > "${TMP_ROOT}/ha-key"
printf '#!/usr/bin/env bash\nexit 0\n' > "${TMP_ROOT}/current/scripts/file-sync.sh"
printf '[Service]\nType=oneshot\n' > "${TMP_ROOT}/current/systemd/file-sync.service"
printf '[Timer]\nOnUnitActiveSec=60\n' > "${TMP_ROOT}/current/systemd/file-sync.timer"

common_env=(
  "PATH=${FAKE_BIN}:${PATH}"
  "ENV_FILE=${TMP_ROOT}/nodeaccess.env"
  "REPLICATION_ENV=${TMP_ROOT}/replication.env"
  "MYSQL_REPLICA_CONFIG_SOURCE=${TMP_ROOT}/replica.cnf"
  "MYSQL_REPLICA_CONFIG=${TMP_ROOT}/mysql/nodeaccess.cnf"
  "FILE_SYNC_ENV=${TMP_ROOT}/file-sync.env"
  "FILE_SYNC_SSH_KEY=${TMP_ROOT}/ha-key"
  "FILE_SYNC_SCRIPT_SOURCE=${TMP_ROOT}/current/scripts/file-sync.sh"
  "FILE_SYNC_SCRIPT_TARGET=${TMP_ROOT}/stable/file-sync.sh"
  "FILE_SYNC_SERVICE_SOURCE=${TMP_ROOT}/current/systemd/file-sync.service"
  "FILE_SYNC_TIMER_SOURCE=${TMP_ROOT}/current/systemd/file-sync.timer"
  "SYSTEMD_UNIT_DIR=${TMP_ROOT}/systemd"
  "STATE_STATUS_SCRIPT=${TMP_ROOT}/state-ok.sh"
  "FILE_STATUS_SCRIPT=${TMP_ROOT}/file-ok.sh"
  "STATE_COMPOSE_FILE=${TMP_ROOT}/state-compose.yml"
  "APP_DOCKER_NETWORK=harness-app-network"
  "NODE_IP=192.0.2.10"
  "REDIS_CONTAINER=harness-redis"
  "REPORT_PATH=${TMP_ROOT}/report.json"
  "FAKE_DOCKER_LOG=${TMP_ROOT}/docker.log"
  "FAKE_SYSTEMCTL_LOG=${TMP_ROOT}/systemctl.log"
)

echo "[nodeaccess] Cenário 1/6: check somente leitura aprovado..."
env "${common_env[@]}" MODE=check bash "$TARGET_SCRIPT"
grep -q '"dataConsistency": "not-checked"' "${TMP_ROOT}/report.json"
grep -q '"readyForFailback": false' "${TMP_ROOT}/report.json"

echo "[nodeaccess] Cenário 2/6: check bloqueia enquanto B possui transações ausentes em A..."
set +e
env "${common_env[@]}" MODE=check ACTIVE_NODE_IP=192.0.2.20 \
  FAKE_SOURCE_AHEAD=true bash "$TARGET_SCRIPT" >/dev/null 2>&1
source_ahead_exit=$?
set -e
[[ "$source_ahead_exit" -ne 0 ]] || {
  echo "[fail] Failback deveria ser bloqueado enquanto o ativo possui GTIDs ausentes." >&2
  exit 1
}
grep -q '"dataConsistency": "failed"' "${TMP_ROOT}/report.json"
grep -q '"missingSourceGtids": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:11-12"' \
  "${TMP_ROOT}/report.json"

echo "[nodeaccess] Cenário 3/6: paridade de GTID libera o check..."
env "${common_env[@]}" MODE=check ACTIVE_NODE_IP=192.0.2.20 \
  FAKE_SOURCE_AHEAD=false bash "$TARGET_SCRIPT"
grep -q '"dataConsistency": "ok"' "${TMP_ROOT}/report.json"
grep -q '"readyForFailback": true' "${TMP_ROOT}/report.json"

echo "[nodeaccess] Cenário 4/6: apply sem confirmação recusado..."
set +e
env "${common_env[@]}" MODE=apply ACTIVE_NODE_IP=192.0.2.20 \
  bash "$TARGET_SCRIPT" >/dev/null 2>&1
missing_confirmation_exit=$?
set -e
[[ "$missing_confirmation_exit" -ne 0 ]] || {
  echo "[fail] Apply sem confirmação deveria falhar." >&2
  exit 1
}

echo "[nodeaccess] Cenário 5/6: GTID errante bloqueia rejoin..."
: > "${TMP_ROOT}/docker.log"
set +e
env "${common_env[@]}" MODE=apply CONFIRM_REJOIN=true \
  ACTIVE_NODE_IP=192.0.2.20 FAKE_ERRANT_GTID=true \
  bash "$TARGET_SCRIPT" >/dev/null 2>&1
errant_exit=$?
set -e
[[ "$errant_exit" -ne 0 ]] || {
  echo "[fail] Rejoin com GTID errante deveria falhar." >&2
  exit 1
}
if grep -q 'CHANGE REPLICATION SOURCE' "${TMP_ROOT}/docker.log"; then
  echo "[fail] Script tentou reconfigurar replicação após detectar split-brain." >&2
  exit 1
fi

echo "[nodeaccess] Cenário 6/6: rejoin válido configura e valida o nó..."
: > "${TMP_ROOT}/docker.log"
: > "${TMP_ROOT}/systemctl.log"
env "${common_env[@]}" MODE=apply CONFIRM_REJOIN=true \
  ACTIVE_NODE_IP=192.0.2.20 FAKE_ERRANT_GTID=false \
  bash "$TARGET_SCRIPT"
grep -q 'CHANGE REPLICATION SOURCE' "${TMP_ROOT}/docker.log"
grep -q 'REPLICAOF 192.0.2.20 6380' "${TMP_ROOT}/docker.log"
grep -q 'compose -p nodeaccess-state' "${TMP_ROOT}/docker.log"
grep -q 'REDIS_REPLICA_HOST=192.0.2.20' "${TMP_ROOT}/docker.log" || {
  echo "[fail] Harness não observou persistência da origem Redis." >&2
  exit 1
}
grep -q 'network connect --alias redis harness-app-network harness-redis' \
  "${TMP_ROOT}/docker.log"
grep -q 'start nodeaccess-ha-file-sync.service' "${TMP_ROOT}/systemctl.log"
grep -q 'daemon-reload' "${TMP_ROOT}/systemctl.log"
cmp -s "${TMP_ROOT}/current/scripts/file-sync.sh" "${TMP_ROOT}/stable/file-sync.sh"
cmp -s "${TMP_ROOT}/current/systemd/file-sync.service" \
  "${TMP_ROOT}/systemd/nodeaccess-ha-file-sync.service"
grep -q 'SOURCE_RSYNC=root@192.0.2.20:/srv/harness-data' "${TMP_ROOT}/file-sync.env"
grep -q '"dataConsistency": "ok"' "${TMP_ROOT}/report.json"
grep -q '"readyForFailback": true' "${TMP_ROOT}/report.json"
grep -q 'NODEACCESS_HA_NODE_ROLE=STANDBY' "$TARGET_SCRIPT"
grep -q 'priority 100' "$TARGET_SCRIPT"

echo "[ok] Harness de preparação do rejoin HA passou."
