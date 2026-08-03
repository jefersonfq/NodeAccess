#!/usr/bin/env bash
set -euo pipefail

# Restaura um backup MySQL em um projeto Docker temporario e isolado.
# Nao toca no banco atual. Por padrao remove containers/volumes ao final.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

DUMP_FILE="${1:-}"
KEEP_RESTORE_HARNESS="${KEEP_RESTORE_HARNESS:-false}"
RESTORE_PROJECT_NAME="${RESTORE_PROJECT_NAME:-nodeaccess-restore-harness-$(date +%Y%m%d%H%M%S)}"
TMP_ROOT="${TMP_ROOT:-$(mktemp -d /tmp/nodeaccess-restore-harness.XXXXXX)}"
RESTORE_ENV_FILE="${TMP_ROOT}/.env"
RESTORE_COMPOSE_FILE="${TMP_ROOT}/docker-compose.restore.yml"

if [[ -z "$DUMP_FILE" ]]; then
  echo "Uso: bash tools/deploy/restore-mysql-isolated-harness.sh <backup.sql.gz>" >&2
  exit 1
fi

if [[ "$DUMP_FILE" != /* ]]; then
  DUMP_FILE="$(cd "$(dirname "$DUMP_FILE")" && pwd)/$(basename "$DUMP_FILE")"
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Backup nao encontrado: $DUMP_FILE" >&2
  exit 1
fi

cleanup() {
  if [[ "$KEEP_RESTORE_HARNESS" == "true" ]]; then
    echo "[nodeaccess] Mantendo harness para inspecao."
    echo "- compose_project_name: $RESTORE_PROJECT_NAME"
    echo "- tmp_root: $TMP_ROOT"
    return
  fi

  docker compose -p "$RESTORE_PROJECT_NAME" -f "$RESTORE_COMPOSE_FILE" --env-file "$RESTORE_ENV_FILE" down -v >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Comando obrigatorio nao encontrado: $1" >&2
    exit 1
  }
}

require_command docker
require_command bash
require_command gunzip

mkdir -p "$TMP_ROOT"

cat > "$RESTORE_ENV_FILE" <<'EOF'
DB_ROOT_PASSWORD=nodeaccess-restore-root
DB_NAME=nodeaccess_restore
DB_USER=nodeaccess_restore
DB_PASSWORD=nodeaccess_restore
PEM_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
MYSQL_ROOT_PASSWORD=nodeaccess-restore-root
MYSQL_DATABASE=nodeaccess_restore
MYSQL_USER=nodeaccess_restore
MYSQL_PASSWORD=nodeaccess_restore
EOF

cat > "$RESTORE_COMPOSE_FILE" <<'EOF'
services:
  mysql:
    image: mysql:8.0
    env_file: .env
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -p$$MYSQL_ROOT_PASSWORD --silent"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 10s
EOF

echo "[nodeaccess] Subindo MySQL isolado para restore..."
docker compose -p "$RESTORE_PROJECT_NAME" -f "$RESTORE_COMPOSE_FILE" --env-file "$RESTORE_ENV_FILE" up -d mysql

echo "[nodeaccess] Aguardando MySQL do harness ficar saudavel..."
for _ in $(seq 1 60); do
  if docker compose -p "$RESTORE_PROJECT_NAME" -f "$RESTORE_COMPOSE_FILE" --env-file "$RESTORE_ENV_FILE" exec -T mysql \
    sh -lc 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker compose -p "$RESTORE_PROJECT_NAME" -f "$RESTORE_COMPOSE_FILE" --env-file "$RESTORE_ENV_FILE" exec -T mysql \
  sh -lc 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' >/dev/null

echo "[nodeaccess] Restaurando backup em MySQL isolado..."
ENV_FILE="$RESTORE_ENV_FILE" \
COMPOSE_FILE="$RESTORE_COMPOSE_FILE" \
COMPOSE_PROJECT_NAME="$RESTORE_PROJECT_NAME" \
RESTORE_PRINT_MIGRATION_HINT=false \
bash "$PROJECT_ROOT/scripts/backup/restore-mysql.sh" "$DUMP_FILE" --yes

echo "[nodeaccess] Restore isolado validado com sucesso."
echo "- backup: $DUMP_FILE"
echo "- compose_project_name: $RESTORE_PROJECT_NAME"
