#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_FILE="${EVIDENCE_FILE:-}"
SIGNATURE_FILE="${SIGNATURE_FILE:-${EVIDENCE_FILE}.sig}"
PUBLIC_KEY="${PUBLIC_KEY:-}"
EXPECTED_PRIMARY_NODE_ID="${EXPECTED_PRIMARY_NODE_ID:-}"
EXPECTED_STANDBY_NODE_ID="${EXPECTED_STANDBY_NODE_ID:-}"
MAX_CLOCK_SKEW_SECONDS="${MAX_CLOCK_SKEW_SECONDS:-30}"
CONSUME_NONCE="${CONSUME_NONCE:-false}"
NONCE_STORE_DIR="${NONCE_STORE_DIR:-/opt/nodeaccess/shared/ha/consumed-nonces}"

for required_file in "$EVIDENCE_FILE" "$SIGNATURE_FILE" "$PUBLIC_KEY"; do
  [[ -f "$required_file" ]] || {
    echo "[fail] Artefato de witness ausente: ${required_file:-nao informado}" >&2
    exit 1
  }
done
[[ -n "$EXPECTED_PRIMARY_NODE_ID" && -n "$EXPECTED_STANDBY_NODE_ID" ]] || {
  echo "[fail] Identificadores esperados do primario e standby sao obrigatorios." >&2
  exit 1
}

openssl dgst -sha256 -verify "$PUBLIC_KEY" -signature "$SIGNATURE_FILE" "$EVIDENCE_FILE" \
  >/dev/null 2>&1 || {
    echo "[fail] Assinatura da evidencia de fencing invalida." >&2
    exit 1
  }

read_field() {
  local key="$1"
  local count
  count="$(awk -F= -v key="$key" '$1 == key { count++ } END { print count + 0 }' "$EVIDENCE_FILE")"
  [[ "$count" == "1" ]] || {
    echo "[fail] Campo ${key} ausente ou duplicado na evidencia." >&2
    exit 1
  }
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1) }' "$EVIDENCE_FILE"
}

contract="$(read_field contract)"
primary_node_id="$(read_field primary_node_id)"
standby_node_id="$(read_field standby_node_id)"
issued_at="$(read_field issued_at)"
expires_at="$(read_field expires_at)"
nonce="$(read_field nonce)"

case "$contract" in
  nodeaccess-ha-fencing-v1)
    isolation="$(read_field isolation)"
    [[ "$isolation" == "confirmed" ]] ||
      { echo "[fail] Evidencia nao confirma isolamento." >&2; exit 1; }
    evidence_kind=fencing
    ;;
  nodeaccess-ha-planned-switchover-v1)
    authorization="$(read_field authorization)"
    [[ "$authorization" == "confirmed" ]] ||
      { echo "[fail] Evidencia nao autoriza a troca planejada." >&2; exit 1; }
    evidence_kind=planned
    ;;
  *)
    echo "[fail] Contrato de witness desconhecido." >&2
    exit 1
    ;;
esac
[[ "$primary_node_id" == "$EXPECTED_PRIMARY_NODE_ID" ]] || { echo "[fail] Evidencia pertence a outro primario." >&2; exit 1; }
[[ "$standby_node_id" == "$EXPECTED_STANDBY_NODE_ID" ]] || { echo "[fail] Evidencia pertence a outro standby." >&2; exit 1; }
[[ "$issued_at" =~ ^[0-9]+$ && "$expires_at" =~ ^[0-9]+$ ]] || { echo "[fail] Validade da evidencia e invalida." >&2; exit 1; }
[[ "$nonce" =~ ^[a-f0-9]{48}$ ]] || { echo "[fail] Nonce da evidencia e invalido." >&2; exit 1; }

now="$(date +%s)"
(( issued_at <= now + MAX_CLOCK_SKEW_SECONDS )) || { echo "[fail] Evidencia emitida no futuro." >&2; exit 1; }
(( expires_at >= now )) || { echo "[fail] Evidencia de fencing expirada." >&2; exit 1; }
(( expires_at - issued_at <= 900 )) || { echo "[fail] Evidencia excede validade maxima de 900 segundos." >&2; exit 1; }

if [[ "$CONSUME_NONCE" == "true" ]]; then
  mkdir -p "$NONCE_STORE_DIR"
  chmod 0700 "$NONCE_STORE_DIR"
  nonce_record="${NONCE_STORE_DIR}/${nonce}"
  if ! mkdir "$nonce_record" 2>/dev/null; then
    echo "[fail] Evidencia de fencing ja foi consumida." >&2
    exit 1
  fi
  chmod 0700 "$nonce_record"
  {
    printf 'consumed_at=%s\n' "$now"
    printf 'primary_node_id=%s\n' "$primary_node_id"
    printf 'standby_node_id=%s\n' "$standby_node_id"
    printf 'evidence_kind=%s\n' "$evidence_kind"
    printf 'evidence_sha256=%s\n' "$(sha256sum "$EVIDENCE_FILE" | awk '{print $1}')"
  } > "${nonce_record}/receipt"
  chmod 0600 "${nonce_record}/receipt"
fi

echo "[ok] Evidencia de fencing valida."
echo "- primary_node_id: $primary_node_id"
echo "- standby_node_id: $standby_node_id"
echo "- expires_at_epoch: $expires_at"
echo "- nonce_consumed: $CONSUME_NONCE"
echo "- evidence_kind: $evidence_kind"
