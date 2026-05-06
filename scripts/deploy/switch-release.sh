#!/usr/bin/env bash
set -euo pipefail

TARGET_RELEASE_DIR_INPUT="${1:-}"
if [[ -z "$TARGET_RELEASE_DIR_INPUT" ]]; then
  echo "Uso: bash scripts/deploy/switch-release.sh <diretorio-da-release-alvo>" >&2
  exit 1
fi

if [[ "$TARGET_RELEASE_DIR_INPUT" = /* ]]; then
  TARGET_RELEASE_DIR="$TARGET_RELEASE_DIR_INPUT"
else
  TARGET_RELEASE_DIR="$(cd "$PWD" && pwd)/$TARGET_RELEASE_DIR_INPUT"
fi

[[ -d "$TARGET_RELEASE_DIR" ]] || {
  echo "Diretorio da release alvo nao encontrado: $TARGET_RELEASE_DIR" >&2
  exit 1
}

TARGET_RELEASE_DIR="$(cd "$TARGET_RELEASE_DIR" && pwd)"

RELEASES_DIR_DEFAULT="$(dirname "$TARGET_RELEASE_DIR")"
DEPLOY_ROOT_DEFAULT="$(dirname "$RELEASES_DIR_DEFAULT")"

DEPLOY_ROOT="${DEPLOY_ROOT:-$DEPLOY_ROOT_DEFAULT}"
RELEASES_DIR="${RELEASES_DIR:-${DEPLOY_ROOT}/releases}"
SHARED_DIR="${SHARED_DIR:-${DEPLOY_ROOT}/shared}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_ROOT}/current}"

TARGET_ENV_LINK="${TARGET_RELEASE_DIR}/.env"
TARGET_CERTS_LINK="${TARGET_RELEASE_DIR}/certs"
TARGET_BACKUPS_LINK="${TARGET_RELEASE_DIR}/backups"
SHARED_ENV_FILE="${SHARED_DIR}/.env"
SHARED_CERTS_DIR="${SHARED_DIR}/certs"
SHARED_BACKUPS_DIR="${SHARED_DIR}/backups"
TARGET_ENV_EXAMPLE="${TARGET_RELEASE_DIR}/.env.example.prod"

ensure_target_file() {
  local file_path="$1"
  [[ -f "$file_path" ]] || {
    echo "Arquivo obrigatorio nao encontrado na release alvo: $file_path" >&2
    exit 1
  }
}

copy_env_seed_if_missing() {
  if [[ -f "$SHARED_ENV_FILE" ]]; then
    return
  fi

  if [[ -f "$TARGET_ENV_LINK" && ! -L "$TARGET_ENV_LINK" ]]; then
    cp "$TARGET_ENV_LINK" "$SHARED_ENV_FILE"
    echo "[nodeaccess] .env compartilhado criado a partir da release alvo."
    return
  fi

  if [[ -L "$CURRENT_LINK" && -f "${CURRENT_LINK}/.env" ]]; then
    cp -L "${CURRENT_LINK}/.env" "$SHARED_ENV_FILE"
    echo "[nodeaccess] .env compartilhado criado a partir da release atual."
    return
  fi

  if [[ -f "$TARGET_ENV_EXAMPLE" ]]; then
    cp "$TARGET_ENV_EXAMPLE" "$SHARED_ENV_FILE"
    echo "[nodeaccess] .env compartilhado criado a partir de .env.example.prod."
    echo "[nodeaccess] Ajuste os valores reais antes de instalar ou atualizar."
    return
  fi

  echo "Nao foi possivel inicializar ${SHARED_ENV_FILE}" >&2
  exit 1
}

copy_certs_seed_if_missing() {
  if [[ -f "${SHARED_CERTS_DIR}/fullchain.pem" || -f "${SHARED_CERTS_DIR}/privkey.pem" ]]; then
    return
  fi

  if [[ -d "$TARGET_CERTS_LINK" && ! -L "$TARGET_CERTS_LINK" ]]; then
    cp -R "${TARGET_CERTS_LINK}/." "$SHARED_CERTS_DIR/" 2>/dev/null || true
    echo "[nodeaccess] Certificados compartilhados copiados da release alvo."
    return
  fi

  if [[ -L "$CURRENT_LINK" && -d "${CURRENT_LINK}/certs" ]]; then
    cp -R -L "${CURRENT_LINK}/certs/." "$SHARED_CERTS_DIR/" 2>/dev/null || true
    echo "[nodeaccess] Certificados compartilhados copiados da release atual."
  fi
}

main() {
  ensure_target_file "${TARGET_RELEASE_DIR}/docker-compose.prod.yml"
  ensure_target_file "${TARGET_RELEASE_DIR}/scripts/deploy/install-nodeaccess.sh"
  ensure_target_file "${TARGET_RELEASE_DIR}/scripts/deploy/update-nodeaccess.sh"

  mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$SHARED_CERTS_DIR" "$SHARED_BACKUPS_DIR"

  copy_env_seed_if_missing
  copy_certs_seed_if_missing

  ln -sfn "$SHARED_ENV_FILE" "$TARGET_ENV_LINK"
  ln -sfn "$SHARED_CERTS_DIR" "$TARGET_CERTS_LINK"
  ln -sfn "$SHARED_BACKUPS_DIR" "$TARGET_BACKUPS_LINK"
  ln -sfn "$TARGET_RELEASE_DIR" "$CURRENT_LINK"

  echo "[nodeaccess] Release promovida para current."
  echo "- deploy_root: $DEPLOY_ROOT"
  echo "- current: $CURRENT_LINK -> $TARGET_RELEASE_DIR"
  echo "- shared_env: $SHARED_ENV_FILE"
  echo "- shared_certs: $SHARED_CERTS_DIR"
  echo "- shared_backups: $SHARED_BACKUPS_DIR"
  echo
  echo "Proximo passo sugerido:"
  echo "bash ${CURRENT_LINK}/scripts/deploy/doctor-nodeaccess.sh"
}

main "$@"
