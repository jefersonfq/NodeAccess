#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${SOURCE_ROOT:-/srv/nodeaccess-shared}"
REPLICA_ROOT="${REPLICA_ROOT:-/srv/nodeaccess-replica}"
MAX_REPLICA_AGE_SECONDS="${MAX_REPLICA_AGE_SECONDS:-120}"
REQUIRE_SOURCE_MATCH="${REQUIRE_SOURCE_MATCH:-true}"
MARKER_FILE="${REPLICA_ROOT}/.last-success"
OUTPUT_FORMAT="${OUTPUT_FORMAT:-text}"

json_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g; s/\n/\\n/g' <<<"$1" | tr -d '\n'
}

emit_json() {
  local status="$1"
  local code="$2"
  local message="$3"
  local age="${4:-null}"
  printf '{"contract":"nodeaccess-ha-status-v1","check":"file-replication","component":"files","status":"%s","observedAt":"%s","details":{"ageSeconds":%s,"maxAgeSeconds":%s,"sourceMatchChecked":%s},"error":' \
    "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$age" \
    "$MAX_REPLICA_AGE_SECONDS" "$REQUIRE_SOURCE_MATCH"
  if [[ "$status" == "ok" ]]; then
    printf 'null}\n'
  else
    printf '{"code":"%s","message":"%s"}}\n' "$code" "$(json_escape "$message")"
  fi
}

fail() {
  local code="$1"
  local message="$2"
  local age="${3:-null}"
  if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    emit_json failed "$code" "$message" "$age"
  else
    echo "[fail] $message" >&2
  fi
  exit 1
}

[[ "$OUTPUT_FORMAT" == "text" || "$OUTPUT_FORMAT" == "json" ]] ||
  fail invalid_output_format "OUTPUT_FORMAT deve ser text ou json."

[[ -f "$MARKER_FILE" ]] || {
  fail marker_missing "Marcador de sincronizacao ausente: $MARKER_FILE"
}

completed_epoch="$(awk -F= '$1 == "completed_epoch" { print $2; exit }' "$MARKER_FILE")"
[[ "$completed_epoch" =~ ^[0-9]+$ ]] || {
  fail marker_invalid "Marcador de sincronizacao invalido: $MARKER_FILE"
}

age_seconds="$(( $(date +%s) - completed_epoch ))"
if ((age_seconds < 0 || age_seconds > MAX_REPLICA_AGE_SECONDS)); then
  fail replica_outside_rpo \
    "Replica de arquivos fora do RPO: age_seconds=$age_seconds max=$MAX_REPLICA_AGE_SECONDS" \
    "$age_seconds"
fi

for storage_name in session-audit user-avatars backups; do
  [[ -d "${REPLICA_ROOT}/${storage_name}" ]] || {
    fail storage_missing "Diretorio replicado ausente: ${REPLICA_ROOT}/${storage_name}" "$age_seconds"
  }
done

if [[ "$REQUIRE_SOURCE_MATCH" == "true" ]]; then
  source_type="$(findmnt -n -o FSTYPE --target "$SOURCE_ROOT" 2>/dev/null || true)"
  [[ "$source_type" == nfs* ]] || {
    fail source_unavailable "NFS de origem indisponivel para comparacao final." "$age_seconds"
  }

  for storage_name in session-audit user-avatars backups; do
    if [[ -n "$(rsync -ani --omit-dir-times --delete --numeric-ids "${SOURCE_ROOT}/${storage_name}/" "${REPLICA_ROOT}/${storage_name}/")" ]]; then
      fail replica_diverged "Replica divergente da origem: $storage_name" "$age_seconds"
    fi
  done
fi

if [[ "$OUTPUT_FORMAT" == "json" ]]; then
  emit_json ok "" "" "$age_seconds"
else
  echo "[ok] Replica de arquivos dentro do gate."
  echo "- age_seconds: $age_seconds"
  echo "- max_age_seconds: $MAX_REPLICA_AGE_SECONDS"
  echo "- source_match_checked: $REQUIRE_SOURCE_MATCH"
fi
