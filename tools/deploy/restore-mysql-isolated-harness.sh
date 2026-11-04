#!/usr/bin/env bash
set -euo pipefail

# Restaura um backup MySQL em um projeto Docker temporario e isolado.
# Nao toca no banco atual. Por padrao remove containers/volumes ao final.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

DUMP_FILE="${1:-}"
KEEP_RESTORE_HARNESS="${KEEP_RESTORE_HARNESS:-false}"
RESTORE_PROJECT_NAME="${RESTORE_PROJECT_NAME:-}"
TMP_ROOT="${TMP_ROOT:-}"
RESTORE_OWNS_WORKSPACE=false
RESTORE_OWNS_PROJECT=false

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

  if [[ "$RESTORE_OWNS_PROJECT" == "true" ]]; then
    docker compose -p "$RESTORE_PROJECT_NAME" -f "$RESTORE_COMPOSE_FILE" --env-file "$RESTORE_ENV_FILE" down -v >/dev/null 2>&1 || true
  fi
  if [[ "$RESTORE_OWNS_WORKSPACE" == "true" ]]; then rm -rf "$TMP_ROOT"; fi
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
require_command node

if [[ -z "$RESTORE_PROJECT_NAME" ]]; then
  RESTORE_PROJECT_NAME="nodeaccess-restore-harness-$(node -e "process.stdout.write(require('node:crypto').randomBytes(12).toString('hex'))")"
fi
if [[ ! "$RESTORE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]+$ ]]; then
  echo "RESTORE_PROJECT_NAME_INVALID" >&2
  exit 1
fi
for resource in container network volume; do
  if [[ "$resource" == "container" ]]; then
    existing="$(docker ps -aq --filter "label=com.docker.compose.project=$RESTORE_PROJECT_NAME")"
  else
    existing="$(docker "$resource" ls -q --filter "label=com.docker.compose.project=$RESTORE_PROJECT_NAME")"
  fi
  if [[ -n "$existing" ]]; then echo "RESTORE_PROJECT_ALREADY_EXISTS" >&2; exit 1; fi
done
if [[ -z "$TMP_ROOT" ]]; then
  TMP_ROOT="$(mktemp -d /tmp/nodeaccess-restore-harness.XXXXXX)"
  RESTORE_OWNS_WORKSPACE=true
fi
node "$SCRIPT_DIR/restore-mysql-env.cjs" "$TMP_ROOT"
RESTORE_OWNS_WORKSPACE=true
RESTORE_ENV_FILE="${TMP_ROOT}/.env"
RESTORE_COMPOSE_FILE="${TMP_ROOT}/docker-compose.restore.yml"
umask 077

cat > "$RESTORE_COMPOSE_FILE" <<'EOF'
services:
  mysql:
    image: nodeaccess-mysql:8.4.12-1
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
RESTORE_OWNS_PROJECT=true
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
