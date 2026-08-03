#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
NODE_A_CONF="${PROJECT_ROOT}/docker/keepalived/keepalived-nodeaccess-node-a.conf.example"
NODE_B_CONF="${PROJECT_ROOT}/docker/keepalived/keepalived-nodeaccess-node-b.conf.example"

extract_value() {
  local file_path="$1"
  local key="$2"
  awk -v key="$key" '$1 == key { print $2; exit }' "$file_path"
}

extract_vip() {
  awk '
    $1 == "virtual_ipaddress" { inside=1; next }
    inside && $1 == "}" { exit }
    inside && NF > 0 { print $1; exit }
  ' "$1"
}

for file_path in "$NODE_A_CONF" "$NODE_B_CONF"; do
  if [[ ! -f "$file_path" ]]; then
    echo "Arquivo de exemplo ausente: $file_path" >&2
    exit 1
  fi

  grep -q 'keepalived-health-check.sh' "$file_path" || {
    echo "Health check ausente em $file_path" >&2
    exit 1
  }
  grep -Eq '^[[:space:]]*weight[[:space:]]+0([[:space:]]|$)' "$file_path" || {
    echo "Health script deve colocar a instancia em FAULT (weight 0): $file_path" >&2
    exit 1
  }
done

node_a_state="$(extract_value "$NODE_A_CONF" state)"
node_b_state="$(extract_value "$NODE_B_CONF" state)"
node_a_priority="$(extract_value "$NODE_A_CONF" priority)"
node_b_priority="$(extract_value "$NODE_B_CONF" priority)"
node_a_vrid="$(extract_value "$NODE_A_CONF" virtual_router_id)"
node_b_vrid="$(extract_value "$NODE_B_CONF" virtual_router_id)"
node_a_vip="$(extract_vip "$NODE_A_CONF")"
node_b_vip="$(extract_vip "$NODE_B_CONF")"

[[ "$node_a_state" == "MASTER" ]] || {
  echo "No A deve iniciar como MASTER." >&2
  exit 1
}

[[ "$node_b_state" == "BACKUP" ]] || {
  echo "No B deve iniciar como BACKUP." >&2
  exit 1
}

if [[ "$node_a_priority" -le "$node_b_priority" ]]; then
  echo "Prioridade do no A deve ser maior que a do no B." >&2
  exit 1
fi

[[ "$node_a_vrid" == "$node_b_vrid" ]] || {
  echo "virtual_router_id deve ser igual nos dois nos." >&2
  exit 1
}

[[ "$node_a_vip" == "$node_b_vip" ]] || {
  echo "VIP deve ser igual nos dois nos." >&2
  exit 1
}

echo "[nodeaccess] Harness de configuracao active/passive Keepalived passou."
