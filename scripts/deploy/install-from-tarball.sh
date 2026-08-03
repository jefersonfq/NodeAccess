#!/usr/bin/env bash
set -euo pipefail

# Wrapper de entrega da release.
# Fluxo:
# 1. extrai o pacote em releases/
# 2. carrega bundle offline de imagens, se existir
# 3. promove a release para current
# 4. dispara install-nodeaccess.sh

ARCHIVE_INPUT="${1:-}"
if [[ -z "$ARCHIVE_INPUT" ]]; then
  echo "Uso: bash scripts/deploy/install-from-tarball.sh <arquivo-da-release.tar.gz>" >&2
  exit 1
fi

if [[ "$ARCHIVE_INPUT" = /* ]]; then
  ARCHIVE_PATH="$ARCHIVE_INPUT"
else
  ARCHIVE_PATH="$(cd "$PWD" && pwd)/$ARCHIVE_INPUT"
fi

[[ -f "$ARCHIVE_PATH" ]] || {
  echo "Arquivo da release nao encontrado: $ARCHIVE_PATH" >&2
  exit 1
}

ARCHIVE_ROOT="$(
  tar -tzf "$ARCHIVE_PATH" |
    awk -F/ 'NR == 1 { root = $1 } $1 != root { invalid = 1 } END { if (!invalid) print root }'
)"
if [[ -z "$ARCHIVE_ROOT" || ! "$ARCHIVE_ROOT" =~ ^nodeaccess-release-[0-9A-Za-z._-]+$ ]]; then
  echo "Estrutura invalida: o pacote deve conter uma unica raiz nodeaccess-release-<versao>." >&2
  exit 1
fi
ARCHIVE_NAME="$ARCHIVE_ROOT"

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/nodeaccess}"
RELEASES_DIR="${RELEASES_DIR:-${DEPLOY_ROOT}/releases}"
SHARED_DIR="${SHARED_DIR:-${DEPLOY_ROOT}/shared}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_ROOT}/current}"
TARGET_RELEASE_DIR="${RELEASES_DIR}/${ARCHIVE_NAME}"
LOAD_OFFLINE_IMAGES="${LOAD_OFFLINE_IMAGES:-true}"
RUN_INSTALL="${RUN_INSTALL:-true}"
REPLACE_EXISTING_RELEASE="${REPLACE_EXISTING_RELEASE:-false}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Comando obrigatorio nao encontrado: $1" >&2
    exit 1
  fi
}

extract_release() {
  mkdir -p "$RELEASES_DIR" "$SHARED_DIR"

  if [[ -d "$TARGET_RELEASE_DIR" ]]; then
    if [[ "$REPLACE_EXISTING_RELEASE" == "true" ]]; then
      case "$TARGET_RELEASE_DIR" in
        "$RELEASES_DIR"/*)
          echo "[nodeaccess] Release ja extraida em $TARGET_RELEASE_DIR. Substituindo por REPLACE_EXISTING_RELEASE=true."
          rm -rf -- "$TARGET_RELEASE_DIR"
          ;;
        *)
          echo "Diretorio alvo fora de RELEASES_DIR. Recusando substituir: $TARGET_RELEASE_DIR" >&2
          exit 1
          ;;
      esac
    else
      echo "[nodeaccess] Release ja extraida em $TARGET_RELEASE_DIR. Reaproveitando."
      return
    fi
  fi

  if [[ -d "$TARGET_RELEASE_DIR" ]]; then
    echo "[nodeaccess] Release ja extraida em $TARGET_RELEASE_DIR. Reaproveitando."
    return
  fi

  echo "[nodeaccess] Extraindo release em $RELEASES_DIR..."
  # A release e sempre extraida com o nome versionado do pacote.
  tar -xzf "$ARCHIVE_PATH" -C "$RELEASES_DIR"
  chown root:root \
    "$TARGET_RELEASE_DIR/scripts/deploy/quiesce-ha-primary.sh" \
    "$TARGET_RELEASE_DIR/scripts/deploy/promote-ha-standby.sh"
  chmod 0755 \
    "$TARGET_RELEASE_DIR/scripts/deploy/quiesce-ha-primary.sh" \
    "$TARGET_RELEASE_DIR/scripts/deploy/promote-ha-standby.sh"
}

load_offline_bundle_if_present() {
  if [[ "$LOAD_OFFLINE_IMAGES" != "true" ]]; then
    return
  fi

  local offline_bundle
  offline_bundle="$(find "$TARGET_RELEASE_DIR" -maxdepth 1 -type f -name 'nodeaccess-images-*.tar.gz' | head -n 1)"
  if [[ -z "$offline_bundle" ]]; then
    return
  fi

  require_command docker
  # Permite instalacao em ambiente offline sem depender de registry acessivel.
  echo "[nodeaccess] Carregando imagens offline do bundle $(basename "$offline_bundle")..."
  gunzip -c "$offline_bundle" | docker load
}

run_switch_release() {
  local switch_script="${TARGET_RELEASE_DIR}/scripts/deploy/switch-release.sh"
  [[ -f "$switch_script" ]] || {
    echo "Script switch-release nao encontrado na release: $switch_script" >&2
    exit 1
  }

  echo "[nodeaccess] Promovendo release para current..."
  DEPLOY_ROOT="$DEPLOY_ROOT" RELEASES_DIR="$RELEASES_DIR" SHARED_DIR="$SHARED_DIR" CURRENT_LINK="$CURRENT_LINK" \
    bash "$switch_script" "$TARGET_RELEASE_DIR"
}

run_install() {
  if [[ "$RUN_INSTALL" != "true" ]]; then
    return
  fi

  local install_script="${CURRENT_LINK}/scripts/deploy/install-nodeaccess.sh"
  [[ -f "$install_script" ]] || {
    echo "Script install-nodeaccess nao encontrado em current: $install_script" >&2
    exit 1
  }

  echo "[nodeaccess] Executando install-nodeaccess.sh..."
  bash "$install_script"
}

main() {
  require_command tar
  # O operador pode chamar este script de dentro de /opt/nodeaccess/current.
  # Ao substituir a release, esse diretorio deixa de existir e comandos como
  # tar falham em getcwd. Use sempre uma raiz estavel antes da remocao.
  mkdir -p "$DEPLOY_ROOT"
  cd "$DEPLOY_ROOT"
  extract_release
  load_offline_bundle_if_present
  run_switch_release
  run_install

  echo "[nodeaccess] Fluxo install-from-tarball concluido."
  echo "- archive: $ARCHIVE_PATH"
  echo "- target_release_dir: $TARGET_RELEASE_DIR"
  echo "- current: $CURRENT_LINK"
}

main "$@"
