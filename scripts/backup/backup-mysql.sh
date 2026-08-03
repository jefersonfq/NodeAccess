#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
ENV_LOADER_SCRIPT="${ENV_LOADER_SCRIPT:-${PROJECT_ROOT}/scripts/lib/load-env-file.sh}"
OUTPUT_DIR="${1:-./backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

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
  DB_NAME
)

USE_EXTERNAL_STATEFUL_SERVICES="${USE_EXTERNAL_STATEFUL_SERVICES:-false}"
if [[ "$USE_EXTERNAL_STATEFUL_SERVICES" == "true" ]]; then
  required_vars+=(DB_HOST DB_USER DB_PASSWORD)
else
  required_vars+=(DB_ROOT_PASSWORD)
fi

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Falta variavel obrigatoria para backup: $var_name" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker nao encontrado no PATH" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

APP_VERSION="unknown"
if [[ -f "${PROJECT_ROOT}/package.json" ]]; then
  APP_VERSION="$(grep -m1 '"version"' "${PROJECT_ROOT}/package.json" | sed -E 's/.*"version": "([^"]+)".*/\1/')"
elif [[ -f "${PROJECT_ROOT}/VERSION" ]]; then
  APP_VERSION="$(head -n 1 "${PROJECT_ROOT}/VERSION" | tr -d '\r')"
fi
HOSTNAME_VALUE="$(hostname 2>/dev/null || echo unknown-host)"
BASE_NAME="nodeaccess-mysql-${DB_NAME}-${TIMESTAMP}"
SQL_GZ_PATH="${OUTPUT_DIR}/${BASE_NAME}.sql.gz"
MANIFEST_PATH="${OUTPUT_DIR}/${BASE_NAME}.manifest.json"
CHECKSUM_PATH="${OUTPUT_DIR}/${BASE_NAME}.sha256"

echo "[nodeaccess] Gerando dump MySQL comprimido em: $SQL_GZ_PATH"

if [[ "$USE_EXTERNAL_STATEFUL_SERVICES" == "true" ]]; then
  DB_PORT="${DB_PORT:-3306}"
  MYSQL_CLIENT_IMAGE="${MYSQL_CLIENT_IMAGE:-mysql:8.0}"
  MYSQL_CLIENT_NETWORK="${MYSQL_CLIENT_NETWORK:-${COMPOSE_PROJECT_NAME}_default}"

  docker run --rm \
    --network "$MYSQL_CLIENT_NETWORK" \
    -e MYSQL_PWD="$DB_PASSWORD" \
    "$MYSQL_CLIENT_IMAGE" \
    mysqldump \
      -h "$DB_HOST" \
      -P "$DB_PORT" \
      -u "$DB_USER" \
      --single-transaction \
      --quick \
      --no-tablespaces \
      --set-gtid-purged=OFF \
      --routines \
      --triggers \
      --events \
      "$DB_NAME" \
    | gzip -c > "$SQL_GZ_PATH"
else
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T mysql \
    sh -lc "exec mysqldump -u root -p\"\$MYSQL_ROOT_PASSWORD\" --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --routines --triggers --events \"\$MYSQL_DATABASE\"" \
    | gzip -c > "$SQL_GZ_PATH"
fi

if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM_VALUE="$(sha256sum "$SQL_GZ_PATH" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  CHECKSUM_VALUE="$(shasum -a 256 "$SQL_GZ_PATH" | awk '{print $1}')"
else
  echo "Nenhum utilitario de checksum encontrado (sha256sum/shasum)" >&2
  exit 1
fi

printf '%s  %s\n' "$CHECKSUM_VALUE" "$(basename "$SQL_GZ_PATH")" > "$CHECKSUM_PATH"

cat > "$MANIFEST_PATH" <<EOF
{
  "type": "nodeaccess-mysql-backup",
  "createdAt": "$(date -Iseconds)",
  "appVersion": "${APP_VERSION:-unknown}",
  "dbName": "${DB_NAME}",
  "sourceHost": "${HOSTNAME_VALUE}",
  "sqlGzFile": "$(basename "$SQL_GZ_PATH")",
  "sha256": "$CHECKSUM_VALUE",
  "pemEncryptionKeyIncluded": false,
  "notes": [
    "This backup contains only the MySQL dump.",
    "Use the same PEM_ENCRYPTION_KEY from the source environment to decrypt existing PEMs and secrets after restore."
  ]
}
EOF

echo "[nodeaccess] Backup concluido."
echo "- dump: $SQL_GZ_PATH"
echo "- manifest: $MANIFEST_PATH"
echo "- checksum: $CHECKSUM_PATH"
echo "- aviso: mantenha a mesma PEM_ENCRYPTION_KEY ao restaurar um banco existente"
