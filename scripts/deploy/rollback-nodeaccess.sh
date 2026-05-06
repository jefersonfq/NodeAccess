#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_RELEASE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

TARGET_RELEASE_DIR="${1:-}"
if [[ -z "$TARGET_RELEASE_DIR" ]]; then
  echo "Uso: bash scripts/deploy/rollback-nodeaccess.sh <diretorio-da-release-alvo>" >&2
  exit 1
fi

if [[ "$TARGET_RELEASE_DIR" != /* ]]; then
  TARGET_RELEASE_DIR="$(cd "$PWD" && pwd)/$TARGET_RELEASE_DIR"
fi

[[ -d "$TARGET_RELEASE_DIR" ]] || {
  echo "Diretorio da release alvo nao encontrado: $TARGET_RELEASE_DIR" >&2
  exit 1
}

TARGET_RELEASE_DIR="$(cd "$TARGET_RELEASE_DIR" && pwd)"

ENV_FILE="${ENV_FILE:-${CURRENT_RELEASE_ROOT}/.env}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
CERTS_DIR="${CERTS_DIR:-${CURRENT_RELEASE_ROOT}/certs}"
BACKUP_DIR="${BACKUP_DIR:-${CURRENT_RELEASE_ROOT}/backups}"
RUN_BACKUP="${RUN_BACKUP:-true}"
RUN_SMOKE_CHECK="${RUN_SMOKE_CHECK:-true}"
RUN_PULL="${RUN_PULL:-false}"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-false}"
PROMOTE_TARGET_RELEASE="${PROMOTE_TARGET_RELEASE:-true}"

TARGET_COMPOSE_FILE="${TARGET_RELEASE_DIR}/docker-compose.prod.yml"
TARGET_VALIDATE_ENV_SCRIPT="${TARGET_RELEASE_DIR}/scripts/install/validate-env.sh"
TARGET_SMOKE_CHECK_SCRIPT="${TARGET_RELEASE_DIR}/scripts/install/smoke-check.sh"
TARGET_BACKUP_SCRIPT="${TARGET_RELEASE_DIR}/scripts/backup/backup-mysql.sh"
TARGET_SWITCH_SCRIPT="${TARGET_RELEASE_DIR}/scripts/deploy/switch-release.sh"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Comando obrigatorio nao encontrado: $1" >&2
    exit 1
  }
}

run_target_compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$TARGET_COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

ensure_target_file() {
  local file_path="$1"
  [[ -f "$file_path" ]] || {
    echo "Arquivo obrigatorio nao encontrado na release alvo: $file_path" >&2
    exit 1
  }
}

ensure_target_certs() {
  if [[ -d "${TARGET_RELEASE_DIR}/certs" ]]; then
    return
  fi

  if [[ ! -d "$CERTS_DIR" ]]; then
    echo "Diretorio de certificados nao encontrado: $CERTS_DIR" >&2
    exit 1
  fi

  ln -sfn "$CERTS_DIR" "${TARGET_RELEASE_DIR}/certs"
}

run_migrations() {
  if [[ "$SKIP_MIGRATIONS" == "true" ]]; then
    echo "[nodeaccess] Migrations ignoradas por SKIP_MIGRATIONS=true."
    return
  fi

  echo "[nodeaccess] Aplicando migrations da release alvo..."
  run_target_compose run --rm api npx prisma migrate deploy
}

main() {
  require_command docker

  [[ -f "$ENV_FILE" ]] || {
    echo "Arquivo de ambiente nao encontrado: $ENV_FILE" >&2
    exit 1
  }

  ensure_target_file "$TARGET_COMPOSE_FILE"
  ensure_target_file "$TARGET_VALIDATE_ENV_SCRIPT"
  ensure_target_file "$TARGET_SMOKE_CHECK_SCRIPT"
  ensure_target_file "$TARGET_BACKUP_SCRIPT"
  ensure_target_certs

  echo "[nodeaccess] Validando ambiente para rollback..."
  bash "$TARGET_VALIDATE_ENV_SCRIPT" "$ENV_FILE"

  echo "[nodeaccess] Validando compose da release alvo..."
  run_target_compose config >/dev/null

  if [[ "$RUN_BACKUP" == "true" ]]; then
    echo "[nodeaccess] Gerando backup antes do rollback..."
    ENV_FILE="$ENV_FILE" COMPOSE_FILE="$TARGET_COMPOSE_FILE" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" bash "$TARGET_BACKUP_SCRIPT" "$BACKUP_DIR"
  fi

  if [[ "$RUN_PULL" == "true" ]]; then
    echo "[nodeaccess] Fazendo pull das imagens da release alvo..."
    run_target_compose pull
  fi

  echo "[nodeaccess] Subindo infra base da release alvo..."
  run_target_compose up -d mysql redis

  run_migrations

  echo "[nodeaccess] Aplicando rollback da stack..."
  run_target_compose up -d

  if [[ "$RUN_SMOKE_CHECK" == "true" ]]; then
    echo "[nodeaccess] Executando smoke check da release alvo..."
    ENV_FILE="$ENV_FILE" bash "$TARGET_SMOKE_CHECK_SCRIPT"
  fi

  if [[ "$PROMOTE_TARGET_RELEASE" == "true" && -f "$TARGET_SWITCH_SCRIPT" ]]; then
    echo "[nodeaccess] Promovendo release alvo para current..."
    bash "$TARGET_SWITCH_SCRIPT" "$TARGET_RELEASE_DIR"
  fi

  echo "[nodeaccess] Rollback concluido."
  echo "- target_release_dir: $TARGET_RELEASE_DIR"
  echo "- compose_project_name: $COMPOSE_PROJECT_NAME"
  echo "- env_file: $ENV_FILE"
  echo "- backup_dir: $BACKUP_DIR"
}

main "$@"
