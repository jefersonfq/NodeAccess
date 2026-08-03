#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WATCHER="$PROJECT_ROOT/scripts/deploy/ha-auto-failover-watch.sh"
HELPER="$PROJECT_ROOT/scripts/deploy/nodeaccess-ha-privileged-helper.sh"
SERVICE="$PROJECT_ROOT/systemd/nodeaccess-ha-auto-failover.service"
TIMER="$PROJECT_ROOT/systemd/nodeaccess-ha-auto-failover.timer"

bash -n "$WATCHER" "$HELPER"
grep -Fq 'NODEACCESS_HA_NODE_ROLE:-}" != STANDBY' "$WATCHER"
grep -Fq 'Um nó local degradado nunca pode solicitar fencing nem promoção.' "$WATCHER"
grep -Fq 'failure_not_confirmed' "$PROJECT_ROOT/tools/ha-witness/fencing-service.mjs"
grep -Fq 'FINAL_SYNC_SOURCE_IP=""' "$WATCHER"
grep -Fq 'require_optional_ip "$FINAL_SYNC_SOURCE_IP"' "$HELPER"
grep -Fq 'OnUnitActiveSec=5s' "$TIMER"
grep -Fq 'ha-auto-failover-watch.sh' "$SERVICE"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/config" <<'EOF'
AUTO_FAILOVER_ENABLED=true
AUTO_FAILOVER_MODE=enforce
EOF
cat > "$tmp/agent.env" <<'EOF'
NODEACCESS_HA_NODE_ROLE=PRIMARY
NODEACCESS_HA_NODE_ID=11111111-1111-1111-1111-111111111111
NODEACCESS_HA_VIRTUAL_IP=192.0.2.105
EOF
mkdir -p "$tmp/state"
printf '6\n' > "$tmp/state/consecutive-failures"
NODEACCESS_HA_AUTO_FAILOVER_CONFIG="$tmp/config" \
NODEACCESS_HA_AGENT_ENV="$tmp/agent.env" \
NODEACCESS_HA_AUTO_FAILOVER_STATE_ROOT="$tmp/state" \
  bash "$WATCHER"
[[ "$(<"$tmp/state/consecutive-failures")" == 0 ]]

echo "[nodeaccess] Contrato de failover automático validado."
