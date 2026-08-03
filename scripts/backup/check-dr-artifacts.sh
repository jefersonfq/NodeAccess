#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_ROOT}/backups}"
CERTS_DIR="${CERTS_DIR:-${PROJECT_ROOT}/certs}"
TLS_MODE="${TLS_MODE:-}"

WARNINGS=0
FAILURES=0

log_ok() {
  echo "[ok] $1"
}

log_warn() {
  echo "[warn] $1"
  WARNINGS=$((WARNINGS + 1))
}

log_fail() {
  echo "[fail] $1"
  FAILURES=$((FAILURES + 1))
}

latest_complete_file() {
  local pattern="$1"
  local suffix="$2"
  local candidate base

  while IFS= read -r candidate; do
    candidate="${candidate#* }"
    base="${candidate%$suffix}"
    if [[ -f "${base}.manifest.json" && -f "${base}.sha256" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(find "$BACKUP_DIR" -type f -name "$pattern" -printf '%T@ %p\n' 2>/dev/null | sort -nr)

  return 0
}

check_checksum_pair() {
  local artifact="$1"
  local checksum="$2"

  if [[ ! -f "$artifact" ]]; then
    log_fail "Artefato ausente para checksum: $artifact"
    return
  fi

  if [[ ! -f "$checksum" ]]; then
    log_fail "Checksum ausente para: $artifact"
    return
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    if (cd "$(dirname "$artifact")" && sha256sum -c "$(basename "$checksum")" >/dev/null); then
      log_ok "Checksum valido: $(basename "$artifact")"
    else
      log_fail "Checksum invalido: $(basename "$artifact")"
    fi
  elif command -v shasum >/dev/null 2>&1; then
    local expected current
    expected="$(awk '{print $1}' "$checksum")"
    current="$(shasum -a 256 "$artifact" | awk '{print $1}')"
    if [[ "$expected" == "$current" ]]; then
      log_ok "Checksum valido: $(basename "$artifact")"
    else
      log_fail "Checksum invalido: $(basename "$artifact")"
    fi
  else
    log_fail "Nenhum utilitario de checksum encontrado (sha256sum/shasum)"
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  log_fail ".env ausente: $ENV_FILE"
else
  log_ok ".env encontrado"
fi

if [[ ! -f "$ENV_LOADER_SCRIPT" ]]; then
  log_fail "Carregador de ambiente ausente: $ENV_LOADER_SCRIPT"
else
  source "$ENV_LOADER_SCRIPT"
  load_env_file "$ENV_FILE"
fi

TLS_MODE="${TLS_MODE:-${TLS_MODE:-provided}}"

if [[ -z "${JWT_SECRET:-}" ]]; then
  log_fail "JWT_SECRET ausente no ambiente"
elif [[ "${#JWT_SECRET}" -lt 32 ]]; then
  log_fail "JWT_SECRET com menos de 32 caracteres"
else
  log_ok "JWT_SECRET presente com tamanho minimo"
fi

if [[ -z "${PEM_ENCRYPTION_KEY:-}" ]]; then
  log_fail "PEM_ENCRYPTION_KEY ausente no ambiente"
elif [[ ! "$PEM_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  log_fail "PEM_ENCRYPTION_KEY invalida; esperado hex de 64 caracteres"
else
  log_ok "PEM_ENCRYPTION_KEY presente em formato valido"
fi

case "$TLS_MODE" in
  off)
    log_warn "TLS_MODE=off; aceitavel em dev/lab, nao recomendado para producao"
    ;;
  provided|selfsigned)
    if [[ -f "${CERTS_DIR}/fullchain.pem" && -f "${CERTS_DIR}/privkey.pem" ]]; then
      log_ok "Certificados TLS encontrados"
    else
      log_fail "Certificados TLS ausentes em $CERTS_DIR"
    fi
    ;;
  *)
    log_fail "TLS_MODE invalido: $TLS_MODE"
    ;;
esac

if [[ ! -d "$BACKUP_DIR" ]]; then
  log_fail "Diretorio de backups ausente: $BACKUP_DIR"
else
  log_ok "Diretorio de backups encontrado"

  MYSQL_BACKUP="$(latest_complete_file 'nodeaccess-mysql-*.sql.gz' '.sql.gz')"
  if [[ -z "$MYSQL_BACKUP" ]]; then
    log_fail "Backup MySQL ausente"
  else
    MYSQL_BASE="${MYSQL_BACKUP%.sql.gz}"
    log_ok "Backup MySQL encontrado: $(basename "$MYSQL_BACKUP")"
    [[ -f "${MYSQL_BASE}.manifest.json" ]] && log_ok "Manifest MySQL encontrado" || log_fail "Manifest MySQL ausente"
    check_checksum_pair "$MYSQL_BACKUP" "${MYSQL_BASE}.sha256"
  fi

  AUDIT_BACKUP="$(latest_complete_file 'nodeaccess-session-audit-*.tar.gz' '.tar.gz')"
  if [[ -z "$AUDIT_BACKUP" ]]; then
    log_fail "Backup de auditoria SSH ausente"
  else
    AUDIT_BASE="${AUDIT_BACKUP%.tar.gz}"
    log_ok "Backup de auditoria SSH encontrado: $(basename "$AUDIT_BACKUP")"
    [[ -f "${AUDIT_BASE}.manifest.json" ]] && log_ok "Manifest de auditoria SSH encontrado" || log_fail "Manifest de auditoria SSH ausente"
    check_checksum_pair "$AUDIT_BACKUP" "${AUDIT_BASE}.sha256"
  fi

  AVATAR_BACKUP="$(latest_complete_file 'nodeaccess-user-avatars-*.tar.gz' '.tar.gz')"
  if [[ -z "$AVATAR_BACKUP" ]]; then
    log_warn "Backup de avatares ausente"
  else
    AVATAR_BASE="${AVATAR_BACKUP%.tar.gz}"
    log_ok "Backup de avatares encontrado: $(basename "$AVATAR_BACKUP")"
    [[ -f "${AVATAR_BASE}.manifest.json" ]] && log_ok "Manifest de avatares encontrado" || log_fail "Manifest de avatares ausente"
    check_checksum_pair "$AVATAR_BACKUP" "${AVATAR_BASE}.sha256"
  fi
fi

echo "[nodeaccess] Check de artefatos DR concluido."
echo "- failures: $FAILURES"
echo "- warnings: $WARNINGS"
echo "- backup_dir: $BACKUP_DIR"
echo "- tls_mode: $TLS_MODE"

if [[ "$FAILURES" -gt 0 ]]; then
  exit 1
fi
