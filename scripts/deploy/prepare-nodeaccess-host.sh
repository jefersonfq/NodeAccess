#!/usr/bin/env bash
set -euo pipefail

# Bootstrap inicial do host de deploy.
# Nao instala o NodeAccess em si. Prepara layout, valida dependencias
# operacionais e aponta pendencias antes do primeiro deploy.
# Se AUTO_INSTALL_DOCKER=true, tenta instalar Docker e Compose plugin
# em distribuicoes Linux suportadas.

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/nodeaccess}"
RELEASES_DIR="${RELEASES_DIR:-${DEPLOY_ROOT}/releases}"
SHARED_DIR="${SHARED_DIR:-${DEPLOY_ROOT}/shared}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_ROOT}/current}"
SHARED_CERTS_DIR="${SHARED_DIR}/certs"
SHARED_BACKUPS_DIR="${SHARED_DIR}/backups"
ENV_FILE="${ENV_FILE:-${SHARED_DIR}/.env}"
MIN_DISK_MB="${MIN_DISK_MB:-2048}"
AUTO_INSTALL_DOCKER="${AUTO_INSTALL_DOCKER:-false}"
AUTO_START_DOCKER="${AUTO_START_DOCKER:-true}"
WARNINGS=0

log_ok() {
  echo "[ok] $1"
}

log_warn() {
  echo "[warn] $1"
  WARNINGS=$((WARNINGS + 1))
}

log_fail() {
  echo "[fail] $1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || log_fail "Comando obrigatorio nao encontrado: $1"
}

detect_os() {
  if [[ ! -f /etc/os-release ]]; then
    log_fail "Nao foi possivel detectar o sistema operacional (/etc/os-release ausente)"
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_VERSION_ID="${VERSION_ID:-unknown}"
  OS_FAMILY="${ID_LIKE:-}"
}

warn_legacy_os() {
  detect_os

  case "${OS_ID}:${OS_VERSION_ID}" in
    centos:7*|rhel:7*|ol:7*)
      log_warn "Sistema legado detectado (${OS_ID} ${OS_VERSION_ID}). Docker pode exigir ajustes manuais e Node.js 20 nao e suportado nativamente nesse host."
      ;;
  esac
}

create_layout() {
  mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$SHARED_CERTS_DIR" "$SHARED_BACKUPS_DIR"
  log_ok "Layout de deploy garantido em $DEPLOY_ROOT"
}

install_docker_with_apt() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/"${OS_ID}"/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${OS_ID} \
    $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_docker_with_dnf() {
  dnf install -y dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_docker_with_yum() {
  yum install -y yum-utils
  yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

maybe_install_docker() {
  if command -v docker >/dev/null 2>&1; then
    return 0
  fi

  if [[ "$AUTO_INSTALL_DOCKER" != "true" ]]; then
    log_fail "Comando obrigatorio nao encontrado: docker. Reexecute com AUTO_INSTALL_DOCKER=true para tentativa automatica."
  fi

  detect_os
  log_warn "docker ausente. Tentando instalacao automatica em ${OS_ID:-unknown} ${OS_VERSION_ID:-unknown}"

  if command -v apt-get >/dev/null 2>&1; then
    install_docker_with_apt
  elif command -v dnf >/dev/null 2>&1; then
    install_docker_with_dnf
  elif command -v yum >/dev/null 2>&1; then
    install_docker_with_yum
  else
    log_fail "Nenhum gerenciador suportado encontrado para instalar docker automaticamente"
  fi

  if [[ "$AUTO_START_DOCKER" == "true" ]]; then
    systemctl enable --now docker
  fi

  require_command docker
}

check_docker() {
  maybe_install_docker
  if docker compose version >/dev/null 2>&1; then
    log_ok "docker compose disponivel"
  else
    log_fail "docker compose nao disponivel"
  fi
}

check_ports() {
  require_command ss

  for port in 80 443; do
    if ss -ltn "( sport = :${port} )" | tail -n +2 | grep -q .; then
      log_warn "Porta ${port} ja esta em uso"
    else
      log_ok "Porta ${port} livre"
    fi
  done
}

check_disk() {
  require_command df
  local available_kb
  available_kb="$(df -Pk "$DEPLOY_ROOT" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -z "$available_kb" ]]; then
    available_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
  fi

  local available_mb
  available_mb=$((available_kb / 1024))

  if (( available_mb < MIN_DISK_MB )); then
    log_warn "Espaco livre baixo: ${available_mb} MB disponiveis"
  else
    log_ok "Espaco livre suficiente: ${available_mb} MB"
  fi
}

check_env_seed() {
  if [[ -f "$ENV_FILE" ]]; then
    log_ok ".env compartilhado ja existe em $ENV_FILE"
  else
    log_warn ".env compartilhado ainda nao existe em $ENV_FILE"
  fi
}

check_certs_seed() {
  if [[ -f "${SHARED_CERTS_DIR}/fullchain.pem" && -f "${SHARED_CERTS_DIR}/privkey.pem" ]]; then
    log_ok "Certificados compartilhados ja existem em $SHARED_CERTS_DIR"
  else
    log_warn "Certificados compartilhados ainda nao existem em $SHARED_CERTS_DIR"
  fi
}

main() {
  require_command bash
  require_command mkdir
  create_layout
  warn_legacy_os
  check_docker
  check_ports
  check_disk
  check_env_seed
  check_certs_seed

  if [[ "$WARNINGS" -eq 0 ]]; then
    echo "[nodeaccess] Preparacao do host concluida sem alertas."
  else
    echo "[nodeaccess] Preparacao do host concluida com ${WARNINGS} alerta(s)."
  fi
  echo "- deploy_root: $DEPLOY_ROOT"
  echo "- releases_dir: $RELEASES_DIR"
  echo "- shared_dir: $SHARED_DIR"
  echo "- current_link: $CURRENT_LINK"
  echo
  echo "Proximo passo sugerido:"
  echo "bash scripts/deploy/install-from-tarball.sh /tmp/nodeaccess-release-<versao>.tar.gz"
}

main "$@"
