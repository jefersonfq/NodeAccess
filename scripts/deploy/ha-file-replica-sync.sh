#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${SOURCE_ROOT:-/srv/nodeaccess-shared}"
SOURCE_RSYNC="${SOURCE_RSYNC:-}"
REPLICA_ROOT="${REPLICA_ROOT:-/srv/nodeaccess-replica}"
LOCK_FILE="${LOCK_FILE:-/run/nodeaccess-ha-file-sync.lock}"
RSYNC_RSH="${RSYNC_RSH:-}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[fail] Comando obrigatorio ausente: $1" >&2
    exit 1
  }
}

require_command flock
require_command rsync

if [[ -z "$SOURCE_RSYNC" ]]; then
  require_command findmnt
  source_type="$(findmnt -n -o FSTYPE --target "$SOURCE_ROOT" 2>/dev/null || true)"
  if [[ "$source_type" != nfs* ]]; then
    echo "[fail] Origem nao e um mount NFS ativo: $SOURCE_ROOT (tipo=${source_type:-ausente})" >&2
    exit 1
  fi
elif [[ "$SOURCE_RSYNC" != *:* ]]; then
  echo "[fail] SOURCE_RSYNC deve usar o formato host:/caminho: $SOURCE_RSYNC" >&2
  exit 1
fi

case "$REPLICA_ROOT" in
  /srv/nodeaccess-replica|/srv/nodeaccess-replica/*|/srv/nodeaccess-shared|/srv/nodeaccess-shared/*) ;;
  *)
    echo "[fail] Destino fora da raiz permitida: $REPLICA_ROOT" >&2
    exit 1
    ;;
esac

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[warn] Outra sincronizacao de arquivos esta em andamento."
  exit 0
fi

started_at="$(date +%s)"
mkdir -p "$REPLICA_ROOT"

for storage_name in session-audit user-avatars backups; do
  target_dir="${REPLICA_ROOT}/${storage_name}"
  mkdir -p "$target_dir"
  if [[ -n "$SOURCE_RSYNC" ]]; then
    source_dir="${SOURCE_RSYNC%/}/${storage_name}"
  else
    source_dir="${SOURCE_ROOT}/${storage_name}"
    [[ -d "$source_dir" ]] || {
      echo "[fail] Origem obrigatoria ausente: $source_dir" >&2
      exit 1
    }
  fi
  if [[ -n "$RSYNC_RSH" ]]; then
    RSYNC_RSH="$RSYNC_RSH" rsync -a --omit-dir-times --delete --delay-updates --numeric-ids "${source_dir}/" "${target_dir}/"
  else
    rsync -a --omit-dir-times --delete --delay-updates --numeric-ids "${source_dir}/" "${target_dir}/"
  fi
done

finished_at="$(date +%s)"
tmp_marker="${REPLICA_ROOT}/.last-success.tmp"
{
  printf 'completed_epoch=%s\n' "$finished_at"
  printf 'duration_seconds=%s\n' "$((finished_at - started_at))"
  printf 'source_root=%s\n' "${SOURCE_RSYNC:-$SOURCE_ROOT}"
  printf 'replica_root=%s\n' "$REPLICA_ROOT"
} > "$tmp_marker"
mv -f "$tmp_marker" "${REPLICA_ROOT}/.last-success"

echo "[ok] Replica assincrona de arquivos atualizada."
echo "- source: ${SOURCE_RSYNC:-$SOURCE_ROOT}"
echo "- replica: $REPLICA_ROOT"
echo "- duration_seconds: $((finished_at - started_at))"
