#!/usr/bin/env bash
set -euo pipefail

: "${PROFILE_FILE:?PROFILE_FILE is required}"

KUBECTL_BIN="${KUBECTL_BIN:-kubectl}"
NODE_BIN="${NODE_BIN:-node}"
NODEACCESS_E2E_NAMESPACE="${NODEACCESS_E2E_NAMESPACE:-nodeaccess-e2e}"
NODEACCESS_E2E_RELEASE="${NODEACCESS_E2E_RELEASE:-nodeaccess}"
GATEWAY_LOCAL_PORT="${GATEWAY_LOCAL_PORT:-13001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT="${NODEACCESS_E2E_RELEASE}-nodeaccess-gateway"
SERVICE="$DEPLOYMENT"
marker_dir="$(mktemp -d /tmp/nodeaccess-drain.XXXXXX)"
port_forward_pid=""

cleanup() {
  [[ -z "$port_forward_pid" ]] || kill "$port_forward_pid" 2>/dev/null || true
  rm -rf "$marker_dir"
}
trap cleanup EXIT

$KUBECTL_BIN -n "$NODEACCESS_E2E_NAMESPACE" scale deployment/"$DEPLOYMENT" --replicas=1 >/dev/null
$KUBECTL_BIN -n "$NODEACCESS_E2E_NAMESPACE" rollout status deployment/"$DEPLOYMENT" --timeout=120s >/dev/null
target="$($KUBECTL_BIN -n "$NODEACCESS_E2E_NAMESPACE" get endpoints "$SERVICE" -o jsonpath='{.subsets[0].addresses[0].targetRef.name}')"

$KUBECTL_BIN -n "$NODEACCESS_E2E_NAMESPACE" port-forward "pod/$target" "$GATEWAY_LOCAL_PORT:3001" >"$marker_dir/port-forward.log" 2>&1 &
port_forward_pid=$!
for _ in $(seq 1 50); do
  grep -q 'Forwarding from' "$marker_dir/port-forward.log" && break
  sleep 0.1
done
grep -q 'Forwarding from' "$marker_dir/port-forward.log" || { cat "$marker_dir/port-forward.log"; exit 1; }

PROFILE_FILE="$PROFILE_FILE" GATEWAY_LOCAL_PORT="$GATEWAY_LOCAL_PORT" DRAIN_MARKER_DIR="$marker_dir" \
  "$NODE_BIN" "$SCRIPT_DIR/helm-gateway-drain-client.cjs" >"$marker_dir/client.json" &
client_pid=$!
for _ in $(seq 1 100); do
  [[ -f "$marker_dir/connected" ]] && break
  sleep 0.1
done
[[ -f "$marker_dir/connected" ]] || { wait "$client_pid"; exit 1; }

touch "$marker_dir/rollout-started"
$KUBECTL_BIN -n "$NODEACCESS_E2E_NAMESPACE" rollout restart deployment/"$DEPLOYMENT" >/dev/null
for _ in $(seq 1 100); do
  deleting="$($KUBECTL_BIN -n "$NODEACCESS_E2E_NAMESPACE" get pod "$target" -o jsonpath='{.metadata.deletionTimestamp}' 2>/dev/null || true)"
  [[ -n "$deleting" ]] && break
  sleep 0.1
done

ready_status="$(curl -s -o "$marker_dir/readiness.json" -w '%{http_code}' "http://127.0.0.1:${GATEWAY_LOCAL_PORT}/health/ready" || true)"
wait "$client_pid"
$KUBECTL_BIN -n "$NODEACCESS_E2E_NAMESPACE" rollout status deployment/"$DEPLOYMENT" --timeout=120s >/dev/null

[[ "$ready_status" == "503" ]] || { echo "Expected readiness 503 during drain, received $ready_status" >&2; exit 1; }
printf '{"target":"%s","readyDuringDrain":%s,"client":' "$target" "$ready_status"
cat "$marker_dir/client.json"
printf '}\n'
