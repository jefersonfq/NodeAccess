#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$ROOT/scripts/deploy/quiesce-ha-primary.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/journal"
printf 'DB_ROOT_PASSWORD=harness\n' > "$TMP/env"

cat > "$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${DOCKER_LOG:?}"
[[ "$*" != *"SELECT @@GLOBAL.read_only"* ]] || printf '0\t0\n'
EOF
cat > "$TMP/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${SYSTEMCTL_LOG:?}"
if [[ "${FAIL_STOP:-false}" == "true" && "$1" == "stop" ]]; then
  exit 1
fi
if [[ "$1" == "stop" ]]; then
  touch "${VIP_STATE:?}"
elif [[ "$1" == "start" ]]; then
  rm -f "${VIP_STATE:?}"
fi
EOF
cat > "$TMP/bin/ip" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ ! -f "${VIP_STATE:?}" ]]; then
  printf 'inet 192.168.1.105/24 scope global eth0\n'
fi
EOF
chmod +x "$TMP/bin/"*

common=(
  "PATH=$TMP/bin:$PATH"
  "ENV_FILE=$TMP/env"
  "JOURNAL_DIR=$TMP/journal"
  "MARKER_FILE=$TMP/marker"
  "DOCKER_LOG=$TMP/docker.log"
  "SYSTEMCTL_LOG=$TMP/systemctl.log"
  "VIP_STATE=$TMP/vip-gone"
  "OPERATION_ID=quiesce-harness"
)

echo "[nodeaccess] Cenário 1/4: apply sem confirmação bloqueia..."
if env "${common[@]}" MODE=apply bash "$TARGET" >/dev/null 2>&1; then
  exit 1
fi

echo "[nodeaccess] Cenário 2/4: falha libera escrita e reinicia Keepalived..."
: > "$TMP/docker.log"; : > "$TMP/systemctl.log"
if env "${common[@]}" MODE=apply CONFIRM_QUIESCE=true FAIL_STOP=true \
  bash "$TARGET" >/dev/null 2>&1; then
  exit 1
fi
grep -q 'super_read_only=OFF' "$TMP/docker.log"
grep -q 'start keepalived' "$TMP/systemctl.log"
[[ ! -f "$TMP/marker" ]]

echo "[nodeaccess] Cenário 3/4: apply congela escrita e libera VIP..."
: > "$TMP/docker.log"; : > "$TMP/systemctl.log"
env "${common[@]}" MODE=apply CONFIRM_QUIESCE=true bash "$TARGET"
grep -q 'super_read_only=ON' "$TMP/docker.log"
grep -q 'stop keepalived' "$TMP/systemctl.log"
[[ -f "$TMP/marker" ]]

echo "[nodeaccess] Cenário 4/4: rollback explícito restaura origem..."
env "${common[@]}" MODE=rollback bash "$TARGET"
grep -q 'super_read_only=OFF' "$TMP/docker.log"
[[ ! -f "$TMP/marker" ]]

echo "[ok] Harness de quiesce do primário passou."
