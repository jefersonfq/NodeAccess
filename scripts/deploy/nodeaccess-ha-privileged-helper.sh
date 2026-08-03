#!/usr/bin/env bash
set -Eeuo pipefail

# Fronteira privilegiada do agente HA. Este helper aceita somente ações
# fechadas e executa scripts versionados com caminhos e ambiente saneados.

ACTION="${1:-}"
CURRENT_ROOT="${NODEACCESS_CURRENT_ROOT:-/opt/nodeaccess/current}"
SHARED_ROOT="${NODEACCESS_SHARED_ROOT:-/opt/nodeaccess/shared}"
AGENT_ROOT="${NODEACCESS_HA_AGENT_ROOT:-/opt/nodeaccess-ha-agent}"
ENV_FILE="${NODEACCESS_ENV_FILE:-${SHARED_ROOT}/.env}"
OPERATION_ID="${OPERATION_ID:-}"
VIRTUAL_IP="${VIRTUAL_IP:-}"
PRIMARY_NODE_ID="${PRIMARY_NODE_ID:-}"
STANDBY_NODE_ID="${STANDBY_NODE_ID:-}"
NODE_IP="${NODE_IP:-}"
FINAL_SYNC_SOURCE_IP="${FINAL_SYNC_SOURCE_IP:-}"
WITNESS_EVIDENCE_FILE="${WITNESS_EVIDENCE_FILE:-}"
WITNESS_SIGNATURE_FILE="${WITNESS_SIGNATURE_FILE:-}"
WITNESS_PUBLIC_KEY="${WITNESS_PUBLIC_KEY:-${SHARED_ROOT}/ha/witness-public.pem}"

fail() {
  echo "[nodeaccess-ha-helper][fail] $*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "execução restrita ao root"
}

require_operation_id() {
  [[ "$OPERATION_ID" =~ ^[A-Za-z0-9._:-]{8,100}$ ]] ||
    fail "OPERATION_ID ausente ou inválido"
}

require_node_id() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9-]{8,64}$ ]] || fail "identificador de nó inválido"
}

require_ip() {
  local value="$1"
  [[ "$value" =~ ^[0-9a-fA-F:.]{3,64}$ ]] || fail "endereço IP inválido"
}

require_optional_ip() {
  local value="$1"
  [[ -z "$value" ]] || require_ip "$value"
}

require_fixed_script() {
  local path="$1"
  [[ "$path" == "${CURRENT_ROOT}/scripts/deploy/"* ]] ||
    fail "script fora da release ativa"
  [[ -f "$path" && ! -L "$path" ]] || fail "script privilegiado ausente ou simbólico: $path"
  [[ "$(stat -c '%U:%G' "$path")" == "root:root" ]] ||
    fail "script privilegiado não pertence a root:root"
  [[ "$(stat -c '%a' "$path")" =~ ^[0-7][0145][0145]$ ]] ||
    fail "script privilegiado gravável por outros"
}

require_witness_path() {
  local path="$1"
  [[ "$path" == "${SHARED_ROOT}/ha/witness/"* ]] ||
    fail "evidência witness fora do diretório permitido"
  [[ -f "$path" && ! -L "$path" ]] || fail "arquivo witness ausente ou simbólico"
}

run_quiesce() {
  local mode="$1"
  local script="${CURRENT_ROOT}/scripts/deploy/quiesce-ha-primary.sh"
  require_operation_id
  require_ip "$VIRTUAL_IP"
  require_fixed_script "$script"
  env -i \
    PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    MODE="$mode" \
    CONFIRM_QUIESCE=true \
    OPERATION_ID="$OPERATION_ID" \
    VIRTUAL_IP="$VIRTUAL_IP" \
    ENV_FILE="$ENV_FILE" \
    JOURNAL_DIR="${SHARED_ROOT}/ha/operations" \
    MARKER_FILE="${SHARED_ROOT}/ha/primary-quiesced" \
    bash "$script"
}

schedule_quiesce() {
  local script="${CURRENT_ROOT}/scripts/deploy/quiesce-ha-primary.sh"
  local unit_suffix
  require_operation_id
  require_ip "$VIRTUAL_IP"
  require_fixed_script "$script"
  command -v systemd-run >/dev/null 2>&1 ||
    fail "systemd-run é obrigatório para armar o quiesce"
  unit_suffix="$(printf '%s' "$OPERATION_ID" | sha256sum | cut -c1-16)"
  systemd-run \
    --unit="nodeaccess-ha-quiesce-${unit_suffix}" \
    --on-active=5s \
    --collect \
    --property=Type=oneshot \
    /usr/bin/env -i \
      PATH=/usr/sbin:/usr/bin:/sbin:/bin \
      MODE=apply \
      CONFIRM_QUIESCE=true \
      OPERATION_ID="$OPERATION_ID" \
      VIRTUAL_IP="$VIRTUAL_IP" \
      ENV_FILE="$ENV_FILE" \
      JOURNAL_DIR="${SHARED_ROOT}/ha/operations" \
      MARKER_FILE="${SHARED_ROOT}/ha/primary-quiesced" \
      /usr/bin/bash "$script"
}

schedule_promotion() {
  local script="${CURRENT_ROOT}/scripts/deploy/promote-ha-standby.sh"
  local unit_suffix
  require_operation_id
  require_node_id "$PRIMARY_NODE_ID"
  require_node_id "$STANDBY_NODE_ID"
  require_ip "$NODE_IP"
  require_optional_ip "$FINAL_SYNC_SOURCE_IP"
  require_ip "$VIRTUAL_IP"
  require_witness_path "$WITNESS_EVIDENCE_FILE"
  require_witness_path "$WITNESS_SIGNATURE_FILE"
  [[ "$WITNESS_PUBLIC_KEY" == "${SHARED_ROOT}/ha/"* ]] ||
    fail "chave witness fora do diretório permitido"
  [[ -f "$WITNESS_PUBLIC_KEY" && ! -L "$WITNESS_PUBLIC_KEY" ]] ||
    fail "chave witness ausente ou simbólica"
  require_fixed_script "$script"
  command -v systemd-run >/dev/null 2>&1 ||
    fail "systemd-run é obrigatório para armar a promoção"
  unit_suffix="$(printf '%s' "$OPERATION_ID" | sha256sum | cut -c1-16)"
  systemd-run \
    --unit="nodeaccess-ha-promote-${unit_suffix}" \
    --on-active=5s \
    --collect \
    --property=Type=oneshot \
    /usr/bin/env -i \
      PATH=/usr/sbin:/usr/bin:/sbin:/bin \
      CONFIRM_PROMOTION=true \
      OPERATION_ID="$OPERATION_ID" \
      PRIMARY_NODE_ID="$PRIMARY_NODE_ID" \
      STANDBY_NODE_ID="$STANDBY_NODE_ID" \
      NODE_IP="$NODE_IP" \
      FINAL_SYNC_SOURCE_IP="$FINAL_SYNC_SOURCE_IP" \
      VIRTUAL_IP="$VIRTUAL_IP" \
      WITNESS_EVIDENCE_FILE="$WITNESS_EVIDENCE_FILE" \
      WITNESS_SIGNATURE_FILE="$WITNESS_SIGNATURE_FILE" \
      WITNESS_PUBLIC_KEY="$WITNESS_PUBLIC_KEY" \
      ENV_FILE="$ENV_FILE" \
      AGENT_ENV_FILE="${AGENT_ROOT}/agent.env" \
      JOURNAL_DIR="${SHARED_ROOT}/ha/operations" \
      /usr/bin/bash "$script"
}

run_promotion() {
  local script="${CURRENT_ROOT}/scripts/deploy/promote-ha-standby.sh"
  require_operation_id
  require_node_id "$PRIMARY_NODE_ID"
  require_node_id "$STANDBY_NODE_ID"
  require_ip "$NODE_IP"
  require_optional_ip "$FINAL_SYNC_SOURCE_IP"
  require_ip "$VIRTUAL_IP"
  require_witness_path "$WITNESS_EVIDENCE_FILE"
  require_witness_path "$WITNESS_SIGNATURE_FILE"
  [[ "$WITNESS_PUBLIC_KEY" == "${SHARED_ROOT}/ha/"* ]] ||
    fail "chave witness fora do diretório permitido"
  [[ -f "$WITNESS_PUBLIC_KEY" && ! -L "$WITNESS_PUBLIC_KEY" ]] ||
    fail "chave witness ausente ou simbólica"
  require_fixed_script "$script"

  env -i \
    PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    CONFIRM_PROMOTION=true \
    OPERATION_ID="$OPERATION_ID" \
    PRIMARY_NODE_ID="$PRIMARY_NODE_ID" \
    STANDBY_NODE_ID="$STANDBY_NODE_ID" \
    NODE_IP="$NODE_IP" \
    FINAL_SYNC_SOURCE_IP="$FINAL_SYNC_SOURCE_IP" \
    VIRTUAL_IP="$VIRTUAL_IP" \
    WITNESS_EVIDENCE_FILE="$WITNESS_EVIDENCE_FILE" \
    WITNESS_SIGNATURE_FILE="$WITNESS_SIGNATURE_FILE" \
    WITNESS_PUBLIC_KEY="$WITNESS_PUBLIC_KEY" \
    ENV_FILE="$ENV_FILE" \
    AGENT_ENV_FILE="${AGENT_ROOT}/agent.env" \
    JOURNAL_DIR="${SHARED_ROOT}/ha/operations" \
    bash "$script"
}

require_root
case "$ACTION" in
  quiesce-primary) run_quiesce apply ;;
  schedule-quiesce-primary) schedule_quiesce ;;
  rollback-primary) run_quiesce rollback ;;
  schedule-promote-standby) schedule_promotion ;;
  promote-standby) run_promotion ;;
  *)
    fail "ação não permitida; use schedule-quiesce-primary, quiesce-primary, rollback-primary, schedule-promote-standby ou promote-standby"
    ;;
esac
