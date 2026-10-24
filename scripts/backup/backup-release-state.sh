#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_ROOT="${DEPLOYMENT_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
ENV_FILE="${ENV_FILE:-${DEPLOYMENT_ROOT}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${DEPLOYMENT_ROOT}/docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nodeaccess}"
BACKUP_ALL_SCRIPT="${BACKUP_ALL_SCRIPT:-${SCRIPT_DIR}/backup-all-nodeaccess.sh}"
OUTPUT_DIR="${1:-}"

if [[ -z "$OUTPUT_DIR" || "$OUTPUT_DIR" != /* ]]; then
  echo 'Uso: DEPLOYMENT_ROOT=/release/atual bash scripts/backup/backup-release-state.sh /backup/novo-diretorio' >&2
  exit 1
fi
for command in docker gzip tar sha256sum; do
  command -v "$command" >/dev/null || { echo "Comando obrigatorio ausente: $command" >&2; exit 1; }
done
for required in "$ENV_FILE" "$COMPOSE_FILE" "$BACKUP_ALL_SCRIPT"; do
  [[ -f "$required" ]] || { echo 'Arquivo de ambiente, compose ou script de backup ausente.' >&2; exit 1; }
done
# Never overwrite an earlier recovery point, even if its attempt failed.
mkdir "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
mkdir "$OUTPUT_DIR/config" "$OUTPUT_DIR/state"

run_compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# Use images attached to containers, not mutable tags in the new release.
container_ids="$(run_compose ps --all -q)"
[[ -n "$container_ids" ]] || { echo 'Nenhum container da instalação encontrado; backup incompleto.' >&2; exit 1; }
: > "$OUTPUT_DIR/images.tsv"
for container_id in $container_ids; do
  record="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}} {{.Image}}' "$container_id")"
  read -r service image_id unexpected <<< "$record"
  if [[ ! "$service" =~ ^[a-zA-Z0-9_-]+$ || ! "$image_id" =~ ^sha256:[a-f0-9]{64}$ || -n "${unexpected:-}" ]]; then
    echo 'Identidade de container/imagem inválida; backup interrompido.' >&2
    exit 1
  fi
  printf '%s\t%s\n' "$service" "$image_id" >> "$OUTPUT_DIR/images.tsv"
done
sort -u "$OUTPUT_DIR/images.tsv" -o "$OUTPUT_DIR/images.tsv"
for service in api ssh-gateway frontend; do
  awk -F '\t' -v service="$service" '$1 == service { found=1 } END { exit !found }' "$OUTPUT_DIR/images.tsv" || {
    echo "Container obrigatório ausente: $service" >&2; exit 1;
  }
done
# Different replicas must agree; a mixed rollout cannot be a single rollback image.
if [[ "$(cut -f1 "$OUTPUT_DIR/images.tsv" | sort | uniq -d | wc -l)" -ne 0 ]]; then
  echo 'Réplicas usam imagens diferentes; concluir ou reverter rollout antes do backup.' >&2
  exit 1
fi
mapfile -t image_ids < <(cut -f2 "$OUTPUT_DIR/images.tsv" | sort -u)
docker image save "${image_ids[@]}" | gzip -c > "$OUTPUT_DIR/images.tar.gz"
gzip -t "$OUTPUT_DIR/images.tar.gz"
printf 'services:\n' > "$OUTPUT_DIR/compose.rollback-images.yml"
while IFS=$'\t' read -r service image_id; do
  printf '  %s:\n    image: "%s"\n    pull_policy: never\n' "$service" "$image_id" >> "$OUTPUT_DIR/compose.rollback-images.yml"
done < "$OUTPUT_DIR/images.tsv"

cp -L "$ENV_FILE" "$OUTPUT_DIR/config/.env"
cp -L "$COMPOSE_FILE" "$OUTPUT_DIR/config/compose.yml"
printf '%s\n' "$DEPLOYMENT_ROOT" > "$OUTPUT_DIR/config/deployment-root.txt"
printf '%s\n' "$COMPOSE_PROJECT_NAME" > "$OUTPUT_DIR/config/compose-project.txt"
# Private keys and certificates are recovery material. Keep this archive private.
paths=()
for candidate in VERSION manifest.json package.json scripts docker certs data/ssh-gateway; do
  [[ ! -e "$DEPLOYMENT_ROOT/$candidate" ]] || paths+=("$candidate")
done
if [[ ${#paths[@]} -gt 0 ]]; then
  tar -czhf "$OUTPUT_DIR/config/release-config.tar.gz" -C "$DEPLOYMENT_ROOT" -- "${paths[@]}"
fi
ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
  CERTS_DIR="${CERTS_DIR:-${DEPLOYMENT_ROOT}/certs}" \
  RUN_MYSQL_BACKUP=true RUN_SESSION_AUDIT_BACKUP=true RUN_USER_AVATAR_BACKUP=true \
  RUN_DR_ARTIFACT_CHECK=true REQUIRE_STATEFUL_BACKUPS=true \
  bash "$BACKUP_ALL_SCRIPT" "$OUTPUT_DIR/state"

# Checksums cover private config too, without displaying its content.
(cd "$OUTPUT_DIR" && find config state -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
(cd "$OUTPUT_DIR" && sha256sum images.tar.gz images.tsv compose.rollback-images.yml >> SHA256SUMS)
(cd "$OUTPUT_DIR" && sha256sum -c SHA256SUMS >/dev/null)
printf '%s\n' 'Backup completo; restauração isolada ainda deve ser validada antes da implantação.' > "$OUTPUT_DIR/BACKUP-COMPLETE"
echo '[nodeaccess] Banco, volumes previstos, imagens em uso e configuração preservados. Validar restore isolado antes do deploy.'
