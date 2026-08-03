#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="${NODEACCESS_HA_AUTO_FAILOVER_CONFIG:-/etc/sysconfig/nodeaccess-ha-autofailover}"
AGENT_ENV_FILE="${NODEACCESS_HA_AGENT_ENV:-/opt/nodeaccess-ha-agent/agent.env}"
STATE_ROOT="${NODEACCESS_HA_AUTO_FAILOVER_STATE_ROOT:-/var/lib/nodeaccess-ha-agent/auto-failover}"
HELPER="${NODEACCESS_HA_HELPER:-/opt/nodeaccess-ha-agent/privileged-helper.sh}"

[[ "$(id -u)" -eq 0 ]] || { echo "[nodeaccess-ha-auto][fail] Execute como root." >&2; exit 1; }
[[ -r "$CONFIG_FILE" && -r "$AGENT_ENV_FILE" ]] || exit 0
source "$CONFIG_FILE"
source "$AGENT_ENV_FILE"

AUTO_FAILOVER_ENABLED="${AUTO_FAILOVER_ENABLED:-false}"
AUTO_FAILOVER_MODE="${AUTO_FAILOVER_MODE:-observe-only}"
PEER_NODE_ID="${PEER_NODE_ID:-}"
PEER_HEALTH_URL="${PEER_HEALTH_URL:-}"
LOCAL_NODE_IP="${LOCAL_NODE_IP:-}"
WITNESS_URL="${WITNESS_URL:-}"
WITNESS_TOKEN="${WITNESS_TOKEN:-}"
WITNESS_PUBLIC_KEY="${WITNESS_PUBLIC_KEY:-/opt/nodeaccess/shared/ha/witness-public.pem}"
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-6}"
PROBE_TIMEOUT_SECONDS="${PROBE_TIMEOUT_SECONDS:-3}"
COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-60}"
ALLOW_HTTP_WITNESS="${ALLOW_HTTP_WITNESS:-false}"
ALLOW_SELF_SIGNED_HEALTH="${ALLOW_SELF_SIGNED_HEALTH:-false}"

[[ "$AUTO_FAILOVER_ENABLED" == true ]] || exit 0
install -d -m 0700 "$STATE_ROOT"
counter_file="$STATE_ROOT/consecutive-failures"
# O contador pertence exclusivamente ao período em que este nó é STANDBY.
# Preservá-lo após uma promoção poderia antecipar indevidamente um failover
# quando os papéis fossem invertidos novamente.
if [[ "${NODEACCESS_HA_NODE_ROLE:-}" != STANDBY ]]; then
  printf '0\n' > "$counter_file"
  chmod 0600 "$counter_file"
  exit 0
fi
[[ "$AUTO_FAILOVER_MODE" == observe-only || "$AUTO_FAILOVER_MODE" == enforce ]] || exit 1
[[ "$PEER_NODE_ID" =~ ^[A-Za-z0-9-]{8,64}$ && "$PEER_NODE_ID" != "$NODEACCESS_HA_NODE_ID" ]] || exit 1
[[ "$LOCAL_NODE_IP" =~ ^[0-9a-fA-F:.]{3,64}$ ]] || exit 1
[[ "$FAILURE_THRESHOLD" =~ ^[0-9]+$ ]] &&
  (( FAILURE_THRESHOLD >= 2 && FAILURE_THRESHOLD <= 60 )) || exit 1
[[ -n "$PEER_HEALTH_URL" && -n "$WITNESS_URL" && ${#WITNESS_TOKEN} -ge 24 ]] || exit 1
if [[ "$WITNESS_URL" != https://* && "$ALLOW_HTTP_WITNESS" != true ]]; then
  echo "[nodeaccess-ha-auto][fail] Witness HTTP permitido apenas com ALLOW_HTTP_WITNESS=true." >&2
  exit 1
fi

exec 9>"$STATE_ROOT/watch.lock"
flock -n 9 || exit 0
last_request_file="$STATE_ROOT/last-request-epoch"
journal_file="$STATE_ROOT/journal.jsonl"
curl_health_args=(-fsS --connect-timeout "$PROBE_TIMEOUT_SECONDS" --max-time "$PROBE_TIMEOUT_SECONDS")
[[ "$ALLOW_SELF_SIGNED_HEALTH" == true ]] && curl_health_args+=(-k)

journal() {
  local event="$1"
  local message="${2:-}"
  printf '{"contract":"nodeaccess-ha-auto-failover-v1","event":"%s","nodeId":"%s","peerNodeId":"%s","mode":"%s","message":"%s","observedAt":"%s"}\n' \
    "$event" "$NODEACCESS_HA_NODE_ID" "$PEER_NODE_ID" "$AUTO_FAILOVER_MODE" \
    "$(sed 's/\\/\\\\/g; s/"/\\"/g' <<<"$message" | tr -d '\r\n')" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$journal_file"
  chmod 0600 "$journal_file"
}

reset_failures() {
  printf '0\n' > "$counter_file"
  chmod 0600 "$counter_file"
}

# Um nó local degradado nunca pode solicitar fencing nem promoção.
if ! curl "${curl_health_args[@]}" -o /dev/null "https://${LOCAL_NODE_IP}/health/deep"; then
  reset_failures
  journal local-unhealthy "Nó local não passou no health profundo."
  exit 0
fi
if curl "${curl_health_args[@]}" -o /dev/null "$PEER_HEALTH_URL"; then
  reset_failures
  exit 0
fi

failures=0
[[ -r "$counter_file" ]] && failures="$(<"$counter_file")"
[[ "$failures" =~ ^[0-9]+$ ]] || failures=0
failures=$((failures + 1))
printf '%s\n' "$failures" > "$counter_file"
chmod 0600 "$counter_file"
journal peer-probe-failed "Falha consecutiva ${failures}/${FAILURE_THRESHOLD}."
(( failures >= FAILURE_THRESHOLD )) || exit 0

now="$(date +%s)"
last_request=0
[[ -r "$last_request_file" ]] && last_request="$(<"$last_request_file")"
[[ "$last_request" =~ ^[0-9]+$ ]] || last_request=0
(( now - last_request >= COOLDOWN_SECONDS )) || exit 0
printf '%s\n' "$now" > "$last_request_file"
chmod 0600 "$last_request_file"

operation_id="auto-${now}-${NODEACCESS_HA_NODE_ID:0:8}"
request_body="$(printf '{"operationId":"%s","requesterNodeId":"%s","targetNodeId":"%s","requestedMode":"%s"}' \
  "$operation_id" "$NODEACCESS_HA_NODE_ID" "$PEER_NODE_ID" "$AUTO_FAILOVER_MODE")"
witness_response="$(
  curl -sS --connect-timeout "$PROBE_TIMEOUT_SECONDS" \
    --max-time $((PROBE_TIMEOUT_SECONDS * FAILURE_THRESHOLD + 30)) \
    -X POST "${WITNESS_URL%/}/v1/fence" \
    -H "Authorization: Bearer $WITNESS_TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$request_body" || true
)"
status="$(sed -n 's/.*"status":"\([^"]*\)".*/\1/p' <<<"$witness_response")"
if [[ "$status" != fenced ]]; then
  journal witness-refused "${status:-sem resposta}; promoção bloqueada."
  exit 0
fi
if [[ "$AUTO_FAILOVER_MODE" != enforce ]]; then
  journal mode-blocked "Witness retornou fencing, mas o agente permanece em observe-only."
  exit 0
fi

evidence_base64="$(sed -n 's/.*"evidenceBase64":"\([^"]*\)".*/\1/p' <<<"$witness_response")"
signature_base64="$(sed -n 's/.*"signatureBase64":"\([^"]*\)".*/\1/p' <<<"$witness_response")"
[[ -n "$evidence_base64" && -n "$signature_base64" && -f "$WITNESS_PUBLIC_KEY" ]] || exit 1
witness_dir="/opt/nodeaccess/shared/ha/witness"
install -d -m 0700 "$witness_dir"
evidence_file="$witness_dir/${operation_id}.txt"
signature_file="$witness_dir/${operation_id}.sig"
printf '%s' "$evidence_base64" | base64 -d > "$evidence_file"
printf '%s' "$signature_base64" | base64 -d > "$signature_file"
chmod 0600 "$evidence_file" "$signature_file"
openssl dgst -sha256 -verify "$WITNESS_PUBLIC_KEY" \
  -signature "$signature_file" "$evidence_file" >/dev/null || exit 1

journal promotion-started "Fencing confirmado; iniciando promoção emergencial."
OPERATION_ID="$operation_id" \
PRIMARY_NODE_ID="$PEER_NODE_ID" \
STANDBY_NODE_ID="$NODEACCESS_HA_NODE_ID" \
NODE_IP="$LOCAL_NODE_IP" \
FINAL_SYNC_SOURCE_IP="" \
VIRTUAL_IP="$NODEACCESS_HA_VIRTUAL_IP" \
WITNESS_EVIDENCE_FILE="$evidence_file" \
WITNESS_SIGNATURE_FILE="$signature_file" \
WITNESS_PUBLIC_KEY="$WITNESS_PUBLIC_KEY" \
  "$HELPER" promote-standby
journal promotion-completed "Promoção emergencial concluída."
