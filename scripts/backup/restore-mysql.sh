#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"
RESTORE_REQUIRE_CHECKSUM="${RESTORE_REQUIRE_CHECKSUM:-true}"
RESTORE_PRINT_MIGRATION_HINT="${RESTORE_PRINT_MIGRATION_HINT:-true}"
DUMP_FILE="${1:-}"
CONFIRM_FLAG="${2:-}"

if [[ -z "$DUMP_FILE" ]]; then
  echo "Uso: bash scripts/backup/restore-mysql.sh <arquivo.sql.gz> [--yes]" >&2
  exit 1
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Arquivo de dump nao encontrado: $DUMP_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de ambiente nao encontrado: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose nao encontrado: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_LOADER_SCRIPT" ]]; then
  echo "Carregador de ambiente nao encontrado: $ENV_LOADER_SCRIPT" >&2
  exit 1
fi

source "$ENV_LOADER_SCRIPT"
load_env_file "$ENV_FILE"

required_vars=(
  DB_ROOT_PASSWORD
  DB_NAME
  PEM_ENCRYPTION_KEY
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Falta variavel obrigatoria para restore: $var_name" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker nao encontrado no PATH" >&2
  exit 1
fi

if [[ ! "$PEM_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "PEM_ENCRYPTION_KEY invalida: esperado hex de 64 caracteres" >&2
  exit 1
fi

MANIFEST_PATH="${DUMP_FILE%.sql.gz}.manifest.json"
CHECKSUM_PATH="${DUMP_FILE%.sql.gz}.sha256"

if [[ -f "$CHECKSUM_PATH" ]]; then
  echo "[nodeaccess] Validando checksum..."
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$DUMP_FILE")" && sha256sum -c "$(basename "$CHECKSUM_PATH")")
  elif command -v shasum >/dev/null 2>&1; then
    EXPECTED="$(awk '{print $1}' "$CHECKSUM_PATH")"
    CURRENT="$(shasum -a 256 "$DUMP_FILE" | awk '{print $1}')"
    if [[ "$EXPECTED" != "$CURRENT" ]]; then
      echo "Checksum invalido para $DUMP_FILE" >&2
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
  echo "[nodeaccess] Aviso: restore sem checksum por RESTORE_REQUIRE_CHECKSUM=false."
fi

if [[ -f "$MANIFEST_PATH" ]]; then
  echo "[nodeaccess] Manifest encontrado: $MANIFEST_PATH"
fi

TABLE_COUNT="$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mysql \
  sh -lc "exec mysql -N -u root -p\"\$MYSQL_ROOT_PASSWORD\" -e \"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'\"" \
  | tr -d '[:space:]')"

if [[ "${TABLE_COUNT:-0}" != "0" && "$CONFIRM_FLAG" != "--yes" ]]; then
  echo "O banco ${DB_NAME} nao esta vazio (${TABLE_COUNT} tabelas detectadas)." >&2
  echo "Repita o comando com --yes para confirmar o restore sobre um ambiente nao vazio." >&2
  exit 1
fi

echo "[nodeaccess] Restaurando dump em ${DB_NAME}..."
gunzip -c "$DUMP_FILE" | docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mysql \
  sh -lc "exec mysql -u root -p\"\$MYSQL_ROOT_PASSWORD\" \"\$MYSQL_DATABASE\""

echo "[nodeaccess] Executando validacao minima pos-restore..."
USERS_COUNT="$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mysql \
  sh -lc "exec mysql -N -u root -p\"\$MYSQL_ROOT_PASSWORD\" -e \"SELECT COUNT(*) FROM ${DB_NAME}.users\"" \
  | tr -d '[:space:]' || true)"
HOSTS_COUNT="$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mysql \
  sh -lc "exec mysql -N -u root -p\"\$MYSQL_ROOT_PASSWORD\" -e \"SELECT COUNT(*) FROM ${DB_NAME}.hosts\"" \
  | tr -d '[:space:]' || true)"
MIGRATIONS_COUNT="$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mysql \
  sh -lc "exec mysql -N -u root -p\"\$MYSQL_ROOT_PASSWORD\" -e \"SELECT COUNT(*) FROM ${DB_NAME}._prisma_migrations\"" \
  | tr -d '[:space:]' || true)"

echo "[nodeaccess] Restore concluido."
echo "- db_name: ${DB_NAME}"
echo "- users_count: ${USERS_COUNT:-unknown}"
echo "- hosts_count: ${HOSTS_COUNT:-unknown}"
echo "- prisma_migrations_count: ${MIGRATIONS_COUNT:-unknown}"
if [[ "$RESTORE_PRINT_MIGRATION_HINT" == "true" ]]; then
  echo "- proximo passo recomendado: docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} run --rm api npx prisma migrate deploy"
fi
echo "- validacao recomendada: login admin, leitura de hosts, leitura de secrets/PEMs e sessao SSH de teste"
