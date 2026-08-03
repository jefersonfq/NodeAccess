#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Uso simples para troca planejada:
  ha-witness-issue-evidence.sh planned PRIMARY_ID STANDBY_ID OUTPUT_PREFIX [PRIVATE_KEY]

Exemplo:
  ha-witness-issue-evidence.sh planned node-a node-b /tmp/switchover-001

A chave padrão é:
  /var/lib/nodeaccess-ha-witness/keys/witness-private.pem

O formato por variáveis de ambiente continua disponível para automação e fencing.
EOF
  exit 0
fi

# O subcomando explícito reduz o procedimento de incidente a uma única linha.
# As variáveis de ambiente permanecem compatíveis com instalações anteriores.
if [[ "${1:-}" == "planned" ]]; then
  [[ $# -ge 4 && $# -le 5 ]] || {
    echo "[fail] Uso: $0 planned PRIMARY_ID STANDBY_ID OUTPUT_PREFIX [PRIVATE_KEY]" >&2
    exit 1
  }
  EVIDENCE_MODE=planned
  CONFIRM_PLANNED_SWITCHOVER=true
  PRIMARY_NODE_ID="$2"
  STANDBY_NODE_ID="$3"
  OUTPUT_PREFIX="$4"
  PRIVATE_KEY="${5:-/var/lib/nodeaccess-ha-witness/keys/witness-private.pem}"
fi

CONFIRM_PRIMARY_FENCED="${CONFIRM_PRIMARY_FENCED:-false}"
CONFIRM_PLANNED_SWITCHOVER="${CONFIRM_PLANNED_SWITCHOVER:-false}"
EVIDENCE_MODE="${EVIDENCE_MODE:-fencing}"
PRIVATE_KEY="${PRIVATE_KEY:-}"
PRIMARY_NODE_ID="${PRIMARY_NODE_ID:-}"
STANDBY_NODE_ID="${STANDBY_NODE_ID:-}"
TTL_SECONDS="${TTL_SECONDS:-300}"
OUTPUT_PREFIX="${OUTPUT_PREFIX:-./nodeaccess-ha-fencing-evidence}"

[[ "$EVIDENCE_MODE" == "fencing" || "$EVIDENCE_MODE" == "planned" ]] || {
  echo "[fail] EVIDENCE_MODE deve ser fencing ou planned." >&2
  exit 1
}
if [[ "$EVIDENCE_MODE" == "fencing" ]]; then
  [[ "$CONFIRM_PRIMARY_FENCED" == "true" ]] || {
    echo "[fail] Evidencia recusada. Confirme o isolamento com CONFIRM_PRIMARY_FENCED=true." >&2
    exit 1
  }
else
  [[ "$CONFIRM_PLANNED_SWITCHOVER" == "true" ]] || {
    echo "[fail] Autorizacao recusada. Confirme a troca com CONFIRM_PLANNED_SWITCHOVER=true." >&2
    exit 1
  }
fi
[[ -f "$PRIVATE_KEY" ]] || {
  echo "[fail] Chave privada do witness ausente: ${PRIVATE_KEY:-nao informada}" >&2
  exit 1
}
[[ "$PRIMARY_NODE_ID" =~ ^[A-Za-z0-9._:-]+$ ]] || {
  echo "[fail] PRIMARY_NODE_ID invalido." >&2
  exit 1
}
[[ "$STANDBY_NODE_ID" =~ ^[A-Za-z0-9._:-]+$ ]] || {
  echo "[fail] STANDBY_NODE_ID invalido." >&2
  exit 1
}
[[ "$PRIMARY_NODE_ID" != "$STANDBY_NODE_ID" ]] || {
  echo "[fail] Primario e standby devem ser diferentes." >&2
  exit 1
}
[[ "$TTL_SECONDS" =~ ^[0-9]+$ ]] && (( TTL_SECONDS >= 30 && TTL_SECONDS <= 900 )) || {
  echo "[fail] TTL_SECONDS deve estar entre 30 e 900." >&2
  exit 1
}

issued_at="$(date +%s)"
expires_at=$((issued_at + TTL_SECONDS))
nonce="$(openssl rand -hex 24)"
payload="${OUTPUT_PREFIX}.txt"
signature="${OUTPUT_PREFIX}.sig"

umask 077
{
  if [[ "$EVIDENCE_MODE" == "planned" ]]; then
    echo "contract=nodeaccess-ha-planned-switchover-v1"
  else
    echo "contract=nodeaccess-ha-fencing-v1"
  fi
  echo "primary_node_id=$PRIMARY_NODE_ID"
  echo "standby_node_id=$STANDBY_NODE_ID"
  if [[ "$EVIDENCE_MODE" == "planned" ]]; then
    echo "authorization=confirmed"
  else
    echo "isolation=confirmed"
  fi
  echo "issued_at=$issued_at"
  echo "expires_at=$expires_at"
  echo "nonce=$nonce"
} > "$payload"
openssl dgst -sha256 -sign "$PRIVATE_KEY" -out "$signature" "$payload"
chmod 0644 "$payload" "$signature"

echo "[ok] Evidencia witness emitida para o modo ${EVIDENCE_MODE}."
echo "- evidence: $payload"
echo "- signature: $signature"
echo "- expires_at_epoch: $expires_at"
