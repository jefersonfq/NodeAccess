#!/usr/bin/env bash
set -euo pipefail

# Bootstrap inicial do host de deploy.
# Nao instala o NodeAccess em si. Prepara layout, valida dependencias
# operacionais e aponta pendencias antes do primeiro deploy.

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/nodeaccess}"
RELEASES_DIR="${RELEASES_DIR:-${DEPLOY_ROOT}/releases}"
SHARED_DIR="${SHARED_DIR:-${DEPLOY_ROOT}/shared}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_ROOT}/current}"
SHARED_CERTS_DIR="${SHARED_DIR}/certs"
SHARED_BACKUPS_DIR="${SHARED_DIR}/backups"
ENV_FILE="${ENV_FILE:-${SHARED_DIR}/.env}"
MIN_DISK_MB="${MIN_DISK_MB:-2048}"
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

create_layout() {
  mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$SHARED_CERTS_DIR" "$SHARED_BACKUPS_DIR"
  log_ok "Layout de deploy garantido em $DEPLOY_ROOT"
}

check_docker() {
  require_command docker
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
