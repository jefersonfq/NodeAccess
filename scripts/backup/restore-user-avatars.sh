#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"
RESTORE_REQUIRE_CHECKSUM="${RESTORE_REQUIRE_CHECKSUM:-true}"
USER_AVATAR_RESTORE_TARGET_DIR="${USER_AVATAR_RESTORE_TARGET_DIR:-}"
USER_AVATAR_VOLUME_NAME="${USER_AVATAR_VOLUME_NAME:-${COMPOSE_PROJECT_NAME}_user_avatar_data}"
RESTORE_HELPER_IMAGE="${RESTORE_HELPER_IMAGE:-mysql:8.0}"
ARCHIVE_FILE="${1:-}"
CONFIRM_FLAG="${2:-}"

if [[ -z "$ARCHIVE_FILE" ]]; then
  echo "Uso: bash scripts/backup/restore-user-avatars.sh <arquivo.tar.gz> [--yes]" >&2
  exit 1
fi

if [[ "$ARCHIVE_FILE" != /* ]]; then
  ARCHIVE_FILE="$(cd "$(dirname "$ARCHIVE_FILE")" && pwd)/$(basename "$ARCHIVE_FILE")"
fi

if [[ ! -f "$ARCHIVE_FILE" ]]; then
  echo "Arquivo de avatares nao encontrado: $ARCHIVE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de ambiente nao encontrado: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_LOADER_SCRIPT" ]]; then
  echo "Carregador de ambiente nao encontrado: $ENV_LOADER_SCRIPT" >&2
  exit 1
fi

source "$ENV_LOADER_SCRIPT"
load_env_file "$ENV_FILE"

if ! command -v tar >/dev/null 2>&1; then
  echo "tar nao encontrado no PATH" >&2
  exit 1
fi

MANIFEST_PATH="${ARCHIVE_FILE%.tar.gz}.manifest.json"
CHECKSUM_PATH="${ARCHIVE_FILE%.tar.gz}.sha256"

if [[ -f "$CHECKSUM_PATH" ]]; then
  echo "[nodeaccess] Validando checksum..."
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$ARCHIVE_FILE")" && sha256sum -c "$(basename "$CHECKSUM_PATH")")
  elif command -v shasum >/dev/null 2>&1; then
    EXPECTED="$(awk '{print $1}' "$CHECKSUM_PATH")"
    CURRENT="$(shasum -a 256 "$ARCHIVE_FILE" | awk '{print $1}')"
    if [[ "$EXPECTED" != "$CURRENT" ]]; then
      echo "Checksum invalido para $ARCHIVE_FILE" >&2
      exit 1
    fi
  else
    echo "Nenhum utilitario de checksum encontrado (sha256sum/shasum)" >&2
    exit 1
  fi
elif [[ "$RESTORE_REQUIRE_CHECKSUM" == "true" ]]; then
  echo "Checksum obrigatorio ausente: $CHECKSUM_PATH" >&2
  echo "Use RESTORE_REQUIRE_CHECKSUM=false apenas em recuperacao manual controlada." >&2
  exit 1
else
  echo "[nodeaccess] Aviso: restore de avatares sem checksum por RESTORE_REQUIRE_CHECKSUM=false."
fi

if [[ -f "$MANIFEST_PATH" ]]; then
  echo "[nodeaccess] Manifest encontrado: $MANIFEST_PATH"
fi

ENTRY_COUNT="$(tar -tzf "$ARCHIVE_FILE" 2>/dev/null | awk '$0 != "." && $0 != "./" { count++ } END { print count + 0 }')"

if [[ -n "$USER_AVATAR_RESTORE_TARGET_DIR" ]]; then
  mkdir -p "$USER_AVATAR_RESTORE_TARGET_DIR"
  if find "$USER_AVATAR_RESTORE_TARGET_DIR" -mindepth 1 -print -quit | grep -q . && [[ "$CONFIRM_FLAG" != "--yes" ]]; then
    echo "Diretorio de destino nao esta vazio: $USER_AVATAR_RESTORE_TARGET_DIR" >&2
    echo "Repita o comando com --yes para substituir o conteudo." >&2
    exit 1
  fi

  echo "[nodeaccess] Restaurando avatares em diretorio: $USER_AVATAR_RESTORE_TARGET_DIR"
  if [[ "$CONFIRM_FLAG" == "--yes" ]]; then
    find "$USER_AVATAR_RESTORE_TARGET_DIR" -mindepth 1 -exec rm -rf {} +
  fi
  tar -xzf "$ARCHIVE_FILE" -C "$USER_AVATAR_RESTORE_TARGET_DIR"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker nao encontrado no PATH" >&2
    echo "Informe USER_AVATAR_RESTORE_TARGET_DIR para restore em diretorio local." >&2
    exit 1
  fi

  if ! docker volume inspect "$USER_AVATAR_VOLUME_NAME" >/dev/null 2>&1; then
    echo "Volume de avatares nao encontrado: $USER_AVATAR_VOLUME_NAME" >&2
    echo "Informe USER_AVATAR_RESTORE_TARGET_DIR para restore em diretorio local." >&2
    exit 1
  fi

  echo "[nodeaccess] Restaurando avatares no volume: $USER_AVATAR_VOLUME_NAME"
  docker run --rm \
    -e ARCHIVE_NAME="$(basename "$ARCHIVE_FILE")" \
    -e CONFIRM_FLAG="$CONFIRM_FLAG" \
    -v "${USER_AVATAR_VOLUME_NAME}:/nodeaccess-user-avatars" \
    -v "$(dirname "$ARCHIVE_FILE"):/nodeaccess-backups:ro" \
    "$RESTORE_HELPER_IMAGE" \
    sh -lc '
      if find /nodeaccess-user-avatars -mindepth 1 -print -quit | grep -q . && [ "$CONFIRM_FLAG" != "--yes" ]; then
        echo "Volume de destino nao esta vazio. Repita com --yes para substituir o conteudo." >&2
        exit 1
      fi
      if [ "$CONFIRM_FLAG" = "--yes" ]; then
        find /nodeaccess-user-avatars -mindepth 1 -exec rm -rf {} +
      fi
      tar -xzf "/nodeaccess-backups/${ARCHIVE_NAME}" -C /nodeaccess-user-avatars
    '
fi

echo "[nodeaccess] Restore de avatares concluido."
echo "- archive: $ARCHIVE_FILE"
echo "- entries: ${ENTRY_COUNT:-0}"
