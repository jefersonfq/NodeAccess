#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

VERSION="${1:-}"
OUTPUT_ROOT_INPUT="${2:-dist/releases}"
INCLUDE_OFFLINE_IMAGES="${INCLUDE_OFFLINE_IMAGES:-true}"
BUILD_RELEASE_IMAGES="${BUILD_RELEASE_IMAGES:-true}"
BACKEND_IMAGE="${BACKEND_IMAGE:-nodeaccess-backend}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-nodeaccess-frontend}"
GUACD_IMAGE="${GUACD_IMAGE:-guacamole/guacd:1.5.5}"
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.0}"
REDIS_IMAGE="${REDIS_IMAGE:-redis:7-alpine}"
BACKEND_DOCKERFILE="${BACKEND_DOCKERFILE:-docker/backend.Dockerfile}"
FRONTEND_DOCKERFILE="${FRONTEND_DOCKERFILE:-docker/frontend.Dockerfile}"
BACKEND_BUILD_TARGET="${BACKEND_BUILD_TARGET:-prod}"
FRONTEND_BUILD_TARGET="${FRONTEND_BUILD_TARGET:-prod}"

if [[ "$OUTPUT_ROOT_INPUT" = /* ]]; then
  OUTPUT_ROOT="$OUTPUT_ROOT_INPUT"
else
  OUTPUT_ROOT="${PROJECT_ROOT}/${OUTPUT_ROOT_INPUT}"
fi

if [[ -z "$VERSION" ]]; then
  VERSION="$(grep -m1 '"version"' "${PROJECT_ROOT}/package.json" | sed -E 's/.*"version": "([^"]+)".*/\1/')"
fi

if [[ -z "$VERSION" ]]; then
  echo "Nao foi possivel determinar a versao da release." >&2
  exit 1
fi

RELEASE_NAME="nodeaccess-release-${VERSION}"
RELEASE_DIR="${OUTPUT_ROOT}/${RELEASE_NAME}"
ARCHIVE_PATH="${OUTPUT_ROOT}/${RELEASE_NAME}.tar.gz"
CHECKSUMS_PATH="${OUTPUT_ROOT}/${RELEASE_NAME}.checksums.txt"
VERSION_FILE="${RELEASE_DIR}/VERSION"
RELEASE_NOTES_FILE="${RELEASE_DIR}/RELEASE-NOTES.md"
MANIFEST_FILE="${RELEASE_DIR}/manifest.json"
OFFLINE_BUNDLE_NAME="nodeaccess-images-${VERSION}.tar.gz"
OFFLINE_BUNDLE_PATH="${RELEASE_DIR}/${OFFLINE_BUNDLE_NAME}"
BACKEND_IMAGE_REF="${BACKEND_IMAGE}:${VERSION}"
FRONTEND_IMAGE_REF="${FRONTEND_IMAGE}:${VERSION}"

mkdir -p "$RELEASE_DIR"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Comando obrigatorio nao encontrado: $1" >&2
    exit 1
  fi
}

ensure_image_exists() {
  local image_ref="$1"
  if ! docker image inspect "$image_ref" >/dev/null 2>&1; then
    echo "Imagem nao encontrada localmente: $image_ref" >&2
    echo "Dica: gere a imagem antes ou execute com BUILD_RELEASE_IMAGES=true." >&2
    exit 1
  fi
}

build_release_images() {
  require_command docker

  echo "[nodeaccess] Buildando imagem backend: ${BACKEND_IMAGE_REF}"
  docker build \
    -f "${PROJECT_ROOT}/${BACKEND_DOCKERFILE}" \
    --target "${BACKEND_BUILD_TARGET}" \
    --build-arg "APP_VERSION=${VERSION}" \
    -t "${BACKEND_IMAGE_REF}" \
    "${PROJECT_ROOT}"

  echo "[nodeaccess] Buildando imagem frontend: ${FRONTEND_IMAGE_REF}"
  docker build \
    -f "${PROJECT_ROOT}/${FRONTEND_DOCKERFILE}" \
    --target "${FRONTEND_BUILD_TARGET}" \
    --build-arg "APP_VERSION=${VERSION}" \
    -t "${FRONTEND_IMAGE_REF}" \
    "${PROJECT_ROOT}"
}

cp "${PROJECT_ROOT}/docker-compose.prod.yml" "${RELEASE_DIR}/docker-compose.prod.yml"
cp "${PROJECT_ROOT}/docker-compose.ha.yml" "${RELEASE_DIR}/docker-compose.ha.yml"
cp "${PROJECT_ROOT}/docker-compose.ha-state.yml" "${RELEASE_DIR}/docker-compose.ha-state.yml"
cp "${PROJECT_ROOT}/docker-compose.ha-state-app-network.yml" "${RELEASE_DIR}/docker-compose.ha-state-app-network.yml"
sed -i -E \
  -e "s|image: ${BACKEND_IMAGE}:[^[:space:]]+|image: ${BACKEND_IMAGE_REF}|g" \
  -e "s|image: ${FRONTEND_IMAGE}:[^[:space:]]+|image: ${FRONTEND_IMAGE_REF}|g" \
  "${RELEASE_DIR}/docker-compose.prod.yml" \
  "${RELEASE_DIR}/docker-compose.ha.yml" \
  "${RELEASE_DIR}/docker-compose.ha-state.yml"
cp "${PROJECT_ROOT}/.env.example.prod" "${RELEASE_DIR}/.env.example.prod"
mkdir -p \
  "${RELEASE_DIR}/scripts/install" \
  "${RELEASE_DIR}/scripts/backup" \
  "${RELEASE_DIR}/scripts/deploy" \
  "${RELEASE_DIR}/scripts/lib" \
  "${RELEASE_DIR}/scripts/release" \
  "${RELEASE_DIR}/apps/backend/scripts" \
  "${RELEASE_DIR}/apps/agent/dist" \
  "${RELEASE_DIR}/docker/keepalived" \
  "${RELEASE_DIR}/docker/mysql/ha" \
  "${RELEASE_DIR}/docker/mysql/conf.d" \
  "${RELEASE_DIR}/docker/nfs" \
  "${RELEASE_DIR}/systemd" \
  "${RELEASE_DIR}/tools/deploy" \
  "${RELEASE_DIR}/tools/ha-witness" \
  "${RELEASE_DIR}/docs"
cp "${PROJECT_ROOT}/scripts/install/validate-env.sh" "${RELEASE_DIR}/scripts/install/validate-env.sh"
cp "${PROJECT_ROOT}/scripts/install/smoke-check.sh" "${RELEASE_DIR}/scripts/install/smoke-check.sh"
cp "${PROJECT_ROOT}/scripts/backup/backup-all-nodeaccess.sh" "${RELEASE_DIR}/scripts/backup/backup-all-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/backup/backup-mysql.sh" "${RELEASE_DIR}/scripts/backup/backup-mysql.sh"
cp "${PROJECT_ROOT}/scripts/backup/restore-mysql.sh" "${RELEASE_DIR}/scripts/backup/restore-mysql.sh"
cp "${PROJECT_ROOT}/scripts/backup/backup-session-audit.sh" "${RELEASE_DIR}/scripts/backup/backup-session-audit.sh"
cp "${PROJECT_ROOT}/scripts/backup/restore-session-audit.sh" "${RELEASE_DIR}/scripts/backup/restore-session-audit.sh"
cp "${PROJECT_ROOT}/scripts/backup/backup-user-avatars.sh" "${RELEASE_DIR}/scripts/backup/backup-user-avatars.sh"
cp "${PROJECT_ROOT}/scripts/backup/restore-user-avatars.sh" "${RELEASE_DIR}/scripts/backup/restore-user-avatars.sh"
cp "${PROJECT_ROOT}/scripts/backup/check-dr-artifacts.sh" "${RELEASE_DIR}/scripts/backup/check-dr-artifacts.sh"
cp "${PROJECT_ROOT}/scripts/lib/load-env-file.sh" "${RELEASE_DIR}/scripts/lib/load-env-file.sh"
cp "${PROJECT_ROOT}/scripts/deploy/install-all-nodeaccess.sh" "${RELEASE_DIR}/scripts/deploy/install-all-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/deploy/install-nodeaccess.sh" "${RELEASE_DIR}/scripts/deploy/install-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/deploy/install-ha-agent.sh" "${RELEASE_DIR}/scripts/deploy/install-ha-agent.sh"
cp "${PROJECT_ROOT}/scripts/deploy/nodeaccess-ha-privileged-helper.sh" "${RELEASE_DIR}/scripts/deploy/nodeaccess-ha-privileged-helper.sh"
cp "${PROJECT_ROOT}/scripts/deploy/ha-auto-failover-watch.sh" "${RELEASE_DIR}/scripts/deploy/ha-auto-failover-watch.sh"
cp "${PROJECT_ROOT}/scripts/deploy/update-nodeaccess.sh" "${RELEASE_DIR}/scripts/deploy/update-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/deploy/doctor-nodeaccess.sh" "${RELEASE_DIR}/scripts/deploy/doctor-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/deploy/ha-state-readiness.sh" "${RELEASE_DIR}/scripts/deploy/ha-state-readiness.sh"
cp "${PROJECT_ROOT}/scripts/deploy/ha-state-replication-status.sh" "${RELEASE_DIR}/scripts/deploy/ha-state-replication-status.sh"
cp "${PROJECT_ROOT}/scripts/deploy/ha-file-replica-sync.sh" "${RELEASE_DIR}/scripts/deploy/ha-file-replica-sync.sh"
cp "${PROJECT_ROOT}/scripts/deploy/ha-file-replica-status.sh" "${RELEASE_DIR}/scripts/deploy/ha-file-replica-status.sh"
cp "${PROJECT_ROOT}/scripts/deploy/prepare-ha-rejoin.sh" "${RELEASE_DIR}/scripts/deploy/prepare-ha-rejoin.sh"
cp "${PROJECT_ROOT}/scripts/deploy/reconcile-ha-empty-gtids.sh" "${RELEASE_DIR}/scripts/deploy/reconcile-ha-empty-gtids.sh"
cp "${PROJECT_ROOT}/scripts/deploy/quiesce-ha-primary.sh" "${RELEASE_DIR}/scripts/deploy/quiesce-ha-primary.sh"
cp "${PROJECT_ROOT}/scripts/deploy/ha-witness-keygen.sh" "${RELEASE_DIR}/scripts/deploy/ha-witness-keygen.sh"
cp "${PROJECT_ROOT}/scripts/deploy/ha-witness-issue-evidence.sh" "${RELEASE_DIR}/scripts/deploy/ha-witness-issue-evidence.sh"
cp "${PROJECT_ROOT}/scripts/deploy/ha-witness-verify-evidence.sh" "${RELEASE_DIR}/scripts/deploy/ha-witness-verify-evidence.sh"
cp "${PROJECT_ROOT}/scripts/deploy/install-ha-witness-authorizer.sh" "${RELEASE_DIR}/scripts/deploy/install-ha-witness-authorizer.sh"
cp "${PROJECT_ROOT}/scripts/deploy/plan-ha-promotion.sh" "${RELEASE_DIR}/scripts/deploy/plan-ha-promotion.sh"
cp "${PROJECT_ROOT}/scripts/deploy/promote-ha-standby.sh" "${RELEASE_DIR}/scripts/deploy/promote-ha-standby.sh"
cp "${PROJECT_ROOT}/scripts/deploy/standby-readiness.sh" "${RELEASE_DIR}/scripts/deploy/standby-readiness.sh"
cp "${PROJECT_ROOT}/scripts/deploy/pre-failover-check.sh" "${RELEASE_DIR}/scripts/deploy/pre-failover-check.sh"
cp "${PROJECT_ROOT}/scripts/deploy/post-failover-check.sh" "${RELEASE_DIR}/scripts/deploy/post-failover-check.sh"
cp "${PROJECT_ROOT}/scripts/deploy/keepalived-health-check.sh" "${RELEASE_DIR}/scripts/deploy/keepalived-health-check.sh"
cp "${PROJECT_ROOT}/scripts/deploy/rollback-nodeaccess.sh" "${RELEASE_DIR}/scripts/deploy/rollback-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/deploy/switch-release.sh" "${RELEASE_DIR}/scripts/deploy/switch-release.sh"
cp "${PROJECT_ROOT}/scripts/deploy/prepare-nodeaccess-host.sh" "${RELEASE_DIR}/scripts/deploy/prepare-nodeaccess-host.sh"
cp "${PROJECT_ROOT}/scripts/deploy/install-from-tarball.sh" "${RELEASE_DIR}/scripts/deploy/install-from-tarball.sh"
cp "${PROJECT_ROOT}/scripts/deploy/generate-self-signed-cert.sh" "${RELEASE_DIR}/scripts/deploy/generate-self-signed-cert.sh"
cp "${PROJECT_ROOT}/apps/backend/scripts/create-superadmin.mjs" "${RELEASE_DIR}/apps/backend/scripts/create-superadmin.mjs"
cp "${PROJECT_ROOT}/apps/backend/scripts/recover-admin-access.mjs" "${RELEASE_DIR}/apps/backend/scripts/recover-admin-access.mjs"
if compgen -G "${PROJECT_ROOT}/apps/agent/dist/*" >/dev/null; then
  cp "${PROJECT_ROOT}/apps/agent/dist/"* "${RELEASE_DIR}/apps/agent/dist/"
fi
cp "${PROJECT_ROOT}/docker/mysql/conf.d/"* "${RELEASE_DIR}/docker/mysql/conf.d/"
cp "${PROJECT_ROOT}/docker/mysql/ha/"* "${RELEASE_DIR}/docker/mysql/ha/"
cp "${PROJECT_ROOT}/docker/keepalived/keepalived-nodeaccess.conf.example" "${RELEASE_DIR}/docker/keepalived/keepalived-nodeaccess.conf.example"
cp "${PROJECT_ROOT}/docker/keepalived/keepalived-nodeaccess-node-a.conf.example" "${RELEASE_DIR}/docker/keepalived/keepalived-nodeaccess-node-a.conf.example"
cp "${PROJECT_ROOT}/docker/keepalived/keepalived-nodeaccess-node-b.conf.example" "${RELEASE_DIR}/docker/keepalived/keepalived-nodeaccess-node-b.conf.example"
cp "${PROJECT_ROOT}/docker/nfs/nodeaccess-ha-poc.exports.example" "${RELEASE_DIR}/docker/nfs/nodeaccess-ha-poc.exports.example"
cp "${PROJECT_ROOT}/systemd/nodeaccess-ha-file-sync.service" "${RELEASE_DIR}/systemd/nodeaccess-ha-file-sync.service"
cp "${PROJECT_ROOT}/systemd/nodeaccess-ha-file-sync.timer" "${RELEASE_DIR}/systemd/nodeaccess-ha-file-sync.timer"
cp "${PROJECT_ROOT}/systemd/nodeaccess-ha-auto-failover.service" "${RELEASE_DIR}/systemd/nodeaccess-ha-auto-failover.service"
cp "${PROJECT_ROOT}/systemd/nodeaccess-ha-auto-failover.timer" "${RELEASE_DIR}/systemd/nodeaccess-ha-auto-failover.timer"
cp "${PROJECT_ROOT}/docker/nginx.http.conf" "${RELEASE_DIR}/docker/nginx.http.conf"
cp "${PROJECT_ROOT}/docker/nginx.https.conf" "${RELEASE_DIR}/docker/nginx.https.conf"
cp "${PROJECT_ROOT}/tools/deploy/dr-validation-harness.sh" "${RELEASE_DIR}/tools/deploy/dr-validation-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/restore-mysql-isolated-harness.sh" "${RELEASE_DIR}/tools/deploy/restore-mysql-isolated-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/restore-session-audit-isolated-harness.sh" "${RELEASE_DIR}/tools/deploy/restore-session-audit-isolated-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/mysql-ha-rejoin-harness.sh" "${RELEASE_DIR}/tools/deploy/mysql-ha-rejoin-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/prepare-ha-rejoin-harness.sh" "${RELEASE_DIR}/tools/deploy/prepare-ha-rejoin-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/reconcile-ha-empty-gtids-harness.sh" "${RELEASE_DIR}/tools/deploy/reconcile-ha-empty-gtids-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/quiesce-ha-primary-harness.sh" "${RELEASE_DIR}/tools/deploy/quiesce-ha-primary-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/ha-switchover-barrier-harness.sh" "${RELEASE_DIR}/tools/deploy/ha-switchover-barrier-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/ha-promotion-plan-harness.sh" "${RELEASE_DIR}/tools/deploy/ha-promotion-plan-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/install-ha-agent-harness.sh" "${RELEASE_DIR}/tools/deploy/install-ha-agent-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/ha-auto-failover-harness.sh" "${RELEASE_DIR}/tools/deploy/ha-auto-failover-harness.sh"
cp "${PROJECT_ROOT}/tools/deploy/ha-fencing-service-harness.mjs" "${RELEASE_DIR}/tools/deploy/ha-fencing-service-harness.mjs"
cp "${PROJECT_ROOT}/tools/deploy/ha-witness-authorizer-harness.sh" "${RELEASE_DIR}/tools/deploy/ha-witness-authorizer-harness.sh"
cp "${PROJECT_ROOT}/tools/ha-witness/fencing-service.mjs" "${RELEASE_DIR}/tools/ha-witness/fencing-service.mjs"
cp "${PROJECT_ROOT}/tools/ha-witness/fencing.config.example.json" "${RELEASE_DIR}/tools/ha-witness/fencing.config.example.json"
cp "${PROJECT_ROOT}/docs/OPERATIONS-ha-dr-runbook-lite.md" "${RELEASE_DIR}/docs/OPERATIONS-ha-dr-runbook-lite.md"
cp "${PROJECT_ROOT}/docs/OPERATIONS-ha-node-install-and-actions.md" "${RELEASE_DIR}/docs/OPERATIONS-ha-node-install-and-actions.md"
cp "${PROJECT_ROOT}/docs/OPERATIONS-ha-state-inventory-lite.md" "${RELEASE_DIR}/docs/OPERATIONS-ha-state-inventory-lite.md"
cp "${PROJECT_ROOT}/docs/OPERATIONS-ha-automatic-fencing-lite.md" "${RELEASE_DIR}/docs/OPERATIONS-ha-automatic-fencing-lite.md"
cp "${PROJECT_ROOT}/docs/OPERATIONS-ha-two-node-milestone-guided-test.md" "${RELEASE_DIR}/docs/OPERATIONS-ha-two-node-milestone-guided-test.md"

chmod +x \
  "${RELEASE_DIR}/scripts/install/validate-env.sh" \
  "${RELEASE_DIR}/scripts/install/smoke-check.sh" \
  "${RELEASE_DIR}/scripts/backup/backup-all-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/backup/backup-mysql.sh" \
  "${RELEASE_DIR}/scripts/backup/restore-mysql.sh" \
  "${RELEASE_DIR}/scripts/backup/backup-session-audit.sh" \
  "${RELEASE_DIR}/scripts/backup/restore-session-audit.sh" \
  "${RELEASE_DIR}/scripts/backup/backup-user-avatars.sh" \
  "${RELEASE_DIR}/scripts/backup/restore-user-avatars.sh" \
  "${RELEASE_DIR}/scripts/backup/check-dr-artifacts.sh" \
  "${RELEASE_DIR}/scripts/lib/load-env-file.sh" \
  "${RELEASE_DIR}/scripts/deploy/install-all-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/deploy/install-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/deploy/install-ha-agent.sh" \
  "${RELEASE_DIR}/scripts/deploy/nodeaccess-ha-privileged-helper.sh" \
  "${RELEASE_DIR}/scripts/deploy/ha-auto-failover-watch.sh" \
  "${RELEASE_DIR}/scripts/deploy/update-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/deploy/doctor-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/deploy/ha-state-readiness.sh" \
  "${RELEASE_DIR}/scripts/deploy/ha-state-replication-status.sh" \
  "${RELEASE_DIR}/scripts/deploy/ha-file-replica-sync.sh" \
  "${RELEASE_DIR}/scripts/deploy/ha-file-replica-status.sh" \
  "${RELEASE_DIR}/scripts/deploy/prepare-ha-rejoin.sh" \
  "${RELEASE_DIR}/scripts/deploy/reconcile-ha-empty-gtids.sh" \
  "${RELEASE_DIR}/scripts/deploy/quiesce-ha-primary.sh" \
  "${RELEASE_DIR}/scripts/deploy/ha-witness-keygen.sh" \
  "${RELEASE_DIR}/scripts/deploy/ha-witness-issue-evidence.sh" \
  "${RELEASE_DIR}/scripts/deploy/ha-witness-verify-evidence.sh" \
  "${RELEASE_DIR}/scripts/deploy/install-ha-witness-authorizer.sh" \
  "${RELEASE_DIR}/scripts/deploy/plan-ha-promotion.sh" \
  "${RELEASE_DIR}/scripts/deploy/promote-ha-standby.sh" \
  "${RELEASE_DIR}/scripts/deploy/standby-readiness.sh" \
  "${RELEASE_DIR}/scripts/deploy/pre-failover-check.sh" \
  "${RELEASE_DIR}/scripts/deploy/post-failover-check.sh" \
  "${RELEASE_DIR}/scripts/deploy/keepalived-health-check.sh" \
  "${RELEASE_DIR}/scripts/deploy/rollback-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/deploy/switch-release.sh" \
  "${RELEASE_DIR}/scripts/deploy/prepare-nodeaccess-host.sh" \
  "${RELEASE_DIR}/scripts/deploy/install-from-tarball.sh" \
  "${RELEASE_DIR}/scripts/deploy/generate-self-signed-cert.sh" \
  "${RELEASE_DIR}/tools/deploy/dr-validation-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/restore-mysql-isolated-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/restore-session-audit-isolated-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/mysql-ha-rejoin-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/prepare-ha-rejoin-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/reconcile-ha-empty-gtids-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/quiesce-ha-primary-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/ha-switchover-barrier-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/ha-promotion-plan-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/install-ha-agent-harness.sh"
chmod +x \
  "${RELEASE_DIR}/tools/deploy/ha-auto-failover-harness.sh" \
  "${RELEASE_DIR}/tools/deploy/ha-witness-authorizer-harness.sh" \
  "${RELEASE_DIR}/tools/ha-witness/fencing-service.mjs"

# O MySQL ignora arquivos de configuracao gravaveis por todos.
chmod 0644 "${RELEASE_DIR}/docker/mysql/conf.d/nodeaccess.cnf"

cat > "$VERSION_FILE" <<EOF
${VERSION}
EOF

cat > "$RELEASE_NOTES_FILE" <<EOF
# Release ${VERSION}

## Destaques de alta disponibilidade
- fluxo homologado para exatamente dois nos de dados: um PRIMARY e um STANDBY
- cadastro, download do agente, provisionamento governado e acompanhamento pelo journal
- tela com as acoes principais Promover este no e Retornar como standby
- validacoes tecnicas ficam recolhidas em opcoes avancadas
- promocao exige preflight, evidencia witness/fencing, paridade e health profundo
- reconciliacao de papeis ocorre somente quando a topologia observada e inequivoca
- instalacao e operacao detalhadas em docs/OPERATIONS-ha-node-install-and-actions.md

## Limites operacionais
- a interface prepara, valida, orienta e registra a operacao, mas nao executa
  fencing nem shell privilegiado remotamente
- o VIP deve ser informado no provisionamento; Keepalived somente o publica
  depois que o no promovido satisfaz os gates de seguranca
- topologias com mais de dois nos de dados e failover autonomo permanecem fora
  do escopo desta versao

## Conteudo do pacote
- docker-compose.prod.yml
- docker-compose.ha.yml
- docker-compose.ha-state.yml
- .env.example.prod
- scripts/install/validate-env.sh
- scripts/install/smoke-check.sh
- scripts/deploy/install-all-nodeaccess.sh
- scripts/deploy/install-nodeaccess.sh
- scripts/deploy/install-ha-agent.sh
- scripts/deploy/update-nodeaccess.sh
- scripts/deploy/doctor-nodeaccess.sh
- scripts/deploy/ha-state-readiness.sh
- scripts/deploy/ha-state-replication-status.sh
- scripts/deploy/ha-file-replica-sync.sh
- scripts/deploy/ha-file-replica-status.sh
- scripts/deploy/prepare-ha-rejoin.sh
- scripts/deploy/reconcile-ha-empty-gtids.sh
- scripts/deploy/quiesce-ha-primary.sh
- scripts/deploy/ha-witness-keygen.sh
- scripts/deploy/ha-witness-issue-evidence.sh
- scripts/deploy/ha-witness-verify-evidence.sh
- scripts/deploy/plan-ha-promotion.sh
- scripts/deploy/promote-ha-standby.sh
- scripts/deploy/standby-readiness.sh
- scripts/deploy/pre-failover-check.sh
- scripts/deploy/post-failover-check.sh
- scripts/deploy/keepalived-health-check.sh
- scripts/deploy/rollback-nodeaccess.sh
- scripts/deploy/switch-release.sh
- scripts/deploy/prepare-nodeaccess-host.sh
- scripts/deploy/install-from-tarball.sh
- scripts/deploy/generate-self-signed-cert.sh
- scripts/lib/load-env-file.sh
- scripts/backup/backup-all-nodeaccess.sh
- scripts/backup/backup-mysql.sh
- scripts/backup/restore-mysql.sh
- scripts/backup/backup-session-audit.sh
- scripts/backup/restore-session-audit.sh
- scripts/backup/backup-user-avatars.sh
- scripts/backup/restore-user-avatars.sh
- scripts/backup/check-dr-artifacts.sh
- apps/backend/scripts/create-superadmin.mjs
- apps/backend/scripts/recover-admin-access.mjs
- apps/agent/dist/nodeaccess-agent-linux
- apps/agent/dist/nodeaccess-agent-macos
- apps/agent/dist/nodeaccess-agent-win.exe
- docker/nginx.http.conf
- docker/nginx.https.conf
- docker/keepalived/keepalived-nodeaccess.conf.example
- docker/keepalived/keepalived-nodeaccess-node-a.conf.example
- docker/keepalived/keepalived-nodeaccess-node-b.conf.example
- docker/mysql/conf.d/*
- docker/nfs/nodeaccess-ha-poc.exports.example
- tools/deploy/dr-validation-harness.sh
- tools/deploy/restore-mysql-isolated-harness.sh
- tools/deploy/restore-session-audit-isolated-harness.sh
- tools/deploy/mysql-ha-rejoin-harness.sh
- tools/deploy/ha-promotion-plan-harness.sh
- tools/deploy/prepare-ha-rejoin-harness.sh
- tools/deploy/reconcile-ha-empty-gtids-harness.sh
- tools/deploy/quiesce-ha-primary-harness.sh
- tools/deploy/ha-switchover-barrier-harness.sh
- docs/OPERATIONS-ha-node-install-and-actions.md
- docs/OPERATIONS-ha-dr-runbook-lite.md
- docs/OPERATIONS-ha-state-inventory-lite.md
- docs/OPERATIONS-ha-two-node-milestone-guided-test.md

## Checklist sugerida de upgrade
1. validar o .env com scripts/install/validate-env.sh
2. preparar host novo com scripts/deploy/prepare-nodeaccess-host.sh quando aplicavel
3. executar backup antes do upgrade
4. executar scripts/deploy/update-nodeaccess.sh
5. validar login admin, hosts, secrets e sessao SSH

## Observacoes
- preserve a mesma PEM_ENCRYPTION_KEY ao restaurar bancos existentes
- backend e frontend devem usar a mesma versao de release
- use docker-compose.ha.yml com USE_EXTERNAL_STATEFUL_SERVICES=true em nos HA
- docker-compose.ha.yml exige MySQL, Redis, auditoria e avatares compartilhados
- TLS_MODE=provided exige ./certs/fullchain.pem e ./certs/privkey.pem
- TLS_MODE=selfsigned pode gerar certificado local com scripts/deploy/generate-self-signed-cert.sh
- TLS_MODE=off sobe sem HTTPS e deve ser restrito a ambiente interno controlado ou reverse proxy externo
EOF

cat > "$MANIFEST_FILE" <<EOF
{
  "type": "nodeaccess-release",
  "version": "${VERSION}",
  "createdAt": "$(date -Iseconds)",
  "artifacts": [
    "docker-compose.prod.yml",
    "docker-compose.ha.yml",
    "docker-compose.ha-state.yml",
    ".env.example.prod",
    "VERSION",
    "RELEASE-NOTES.md",
    "manifest.json",
    "scripts/install/validate-env.sh",
    "scripts/install/smoke-check.sh",
    "scripts/deploy/install-all-nodeaccess.sh",
    "scripts/deploy/install-nodeaccess.sh",
    "scripts/deploy/install-ha-agent.sh",
    "scripts/deploy/update-nodeaccess.sh",
    "scripts/deploy/doctor-nodeaccess.sh",
    "scripts/deploy/ha-state-readiness.sh",
    "scripts/deploy/ha-state-replication-status.sh",
    "scripts/deploy/ha-file-replica-sync.sh",
    "scripts/deploy/ha-file-replica-status.sh",
    "scripts/deploy/prepare-ha-rejoin.sh",
    "scripts/deploy/reconcile-ha-empty-gtids.sh",
    "scripts/deploy/quiesce-ha-primary.sh",
    "scripts/deploy/ha-witness-keygen.sh",
    "scripts/deploy/ha-witness-issue-evidence.sh",
    "scripts/deploy/ha-witness-verify-evidence.sh",
    "scripts/deploy/plan-ha-promotion.sh",
    "scripts/deploy/promote-ha-standby.sh",
    "scripts/deploy/standby-readiness.sh",
    "scripts/deploy/pre-failover-check.sh",
    "scripts/deploy/post-failover-check.sh",
    "scripts/deploy/keepalived-health-check.sh",
    "scripts/deploy/rollback-nodeaccess.sh",
    "scripts/deploy/switch-release.sh",
    "scripts/deploy/prepare-nodeaccess-host.sh",
    "scripts/deploy/install-from-tarball.sh",
    "scripts/deploy/generate-self-signed-cert.sh",
    "scripts/lib/load-env-file.sh",
    "scripts/backup/backup-all-nodeaccess.sh",
    "scripts/backup/backup-mysql.sh",
    "scripts/backup/restore-mysql.sh",
    "scripts/backup/backup-session-audit.sh",
    "scripts/backup/restore-session-audit.sh",
    "scripts/backup/backup-user-avatars.sh",
    "scripts/backup/restore-user-avatars.sh",
    "scripts/backup/check-dr-artifacts.sh",
    "apps/backend/scripts/create-superadmin.mjs",
    "apps/backend/scripts/recover-admin-access.mjs",
    "apps/agent/dist/nodeaccess-agent-linux",
    "apps/agent/dist/nodeaccess-agent-macos",
    "apps/agent/dist/nodeaccess-agent-win.exe",
    "docker/nginx.http.conf",
    "docker/nginx.https.conf",
    "docker/keepalived/keepalived-nodeaccess.conf.example",
    "docker/keepalived/keepalived-nodeaccess-node-a.conf.example",
    "docker/keepalived/keepalived-nodeaccess-node-b.conf.example",
    "docker/mysql/conf.d/nodeaccess.cnf"
    ,"docker/nfs/nodeaccess-ha-poc.exports.example"
    ,"tools/deploy/dr-validation-harness.sh"
    ,"tools/deploy/restore-mysql-isolated-harness.sh"
    ,"tools/deploy/restore-session-audit-isolated-harness.sh"
    ,"tools/deploy/mysql-ha-rejoin-harness.sh"
    ,"tools/deploy/ha-promotion-plan-harness.sh"
    ,"tools/deploy/install-ha-agent-harness.sh"
    ,"tools/deploy/prepare-ha-rejoin-harness.sh"
    ,"tools/deploy/reconcile-ha-empty-gtids-harness.sh"
    ,"tools/deploy/quiesce-ha-primary-harness.sh"
    ,"tools/deploy/ha-switchover-barrier-harness.sh"
    ,"docs/OPERATIONS-ha-dr-runbook-lite.md"
    ,"docs/OPERATIONS-ha-node-install-and-actions.md"
    ,"docs/OPERATIONS-ha-state-inventory-lite.md"
    ,"docs/OPERATIONS-ha-two-node-milestone-guided-test.md"
  ],
  "images": {
    "backend": "${BACKEND_IMAGE_REF}",
    "frontend": "${FRONTEND_IMAGE_REF}"
  },
  "offlineBundleIncluded": ${INCLUDE_OFFLINE_IMAGES},
  "imagesBuiltByReleaseScript": ${BUILD_RELEASE_IMAGES}
}
EOF

validate_release_contents() {
  local required_path
  local required_paths=(
    "docker-compose.prod.yml"
    "docker-compose.ha.yml"
    "docker-compose.ha-state.yml"
    "scripts/deploy/install-nodeaccess.sh"
    "scripts/deploy/install-ha-agent.sh"
    "scripts/deploy/standby-readiness.sh"
    "scripts/deploy/ha-state-replication-status.sh"
    "scripts/deploy/ha-file-replica-sync.sh"
    "scripts/deploy/ha-file-replica-status.sh"
    "scripts/deploy/prepare-ha-rejoin.sh"
    "scripts/deploy/reconcile-ha-empty-gtids.sh"
    "scripts/deploy/quiesce-ha-primary.sh"
    "scripts/deploy/ha-witness-keygen.sh"
    "scripts/deploy/ha-witness-issue-evidence.sh"
    "scripts/deploy/ha-witness-verify-evidence.sh"
    "scripts/deploy/plan-ha-promotion.sh"
    "scripts/deploy/promote-ha-standby.sh"
    "tools/deploy/dr-validation-harness.sh"
    "tools/deploy/restore-mysql-isolated-harness.sh"
    "tools/deploy/restore-session-audit-isolated-harness.sh"
    "tools/deploy/mysql-ha-rejoin-harness.sh"
    "tools/deploy/prepare-ha-rejoin-harness.sh"
    "tools/deploy/reconcile-ha-empty-gtids-harness.sh"
    "tools/deploy/quiesce-ha-primary-harness.sh"
    "tools/deploy/ha-switchover-barrier-harness.sh"
    "tools/deploy/ha-promotion-plan-harness.sh"
    "tools/deploy/install-ha-agent-harness.sh"
    "docker/mysql/conf.d/nodeaccess.cnf"
    "docker/nfs/nodeaccess-ha-poc.exports.example"
    "docs/OPERATIONS-ha-node-install-and-actions.md"
    "docs/OPERATIONS-ha-two-node-milestone-guided-test.md"
  )

  for required_path in "${required_paths[@]}"; do
    if [[ ! -f "${RELEASE_DIR}/${required_path}" ]]; then
      echo "Artefato obrigatorio ausente na release: ${required_path}" >&2
      exit 1
    fi
  done

  if [[ "$(stat -c '%a' "${RELEASE_DIR}/docker/mysql/conf.d/nodeaccess.cnf")" != "644" ]]; then
    echo "[nodeaccess] Aviso: o filesystem de build nao preservou 0644 em docker/mysql/conf.d/nodeaccess.cnf."
    echo "[nodeaccess] As permissoes serao normalizadas no arquivo tar para remover escrita de grupo/outros."
  fi
}

validate_release_contents

if [[ "$INCLUDE_OFFLINE_IMAGES" == "true" ]]; then
  require_command docker

  if [[ "$BUILD_RELEASE_IMAGES" == "true" ]]; then
    build_release_images
  fi

  ensure_image_exists "$BACKEND_IMAGE_REF"
  ensure_image_exists "$FRONTEND_IMAGE_REF"
  ensure_image_exists "$GUACD_IMAGE"
  ensure_image_exists "$MYSQL_IMAGE"
  ensure_image_exists "$REDIS_IMAGE"

  echo "[nodeaccess] Gerando bundle offline de imagens..."
  docker save \
    "${BACKEND_IMAGE_REF}" \
    "${FRONTEND_IMAGE_REF}" \
    "$GUACD_IMAGE" \
    "$MYSQL_IMAGE" \
    "$REDIS_IMAGE" \
    | gzip -c > "$OFFLINE_BUNDLE_PATH"
fi

rm -f "$ARCHIVE_PATH" "$CHECKSUMS_PATH"
if [[ -f "$OFFLINE_BUNDLE_PATH" ]]; then
  (
    cd "$RELEASE_DIR"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$OFFLINE_BUNDLE_NAME" > RELEASE-CHECKSUMS.txt
    elif command -v shasum >/dev/null 2>&1; then
      shasum -a 256 "$OFFLINE_BUNDLE_NAME" > RELEASE-CHECKSUMS.txt
    else
      echo "Nenhum utilitario de checksum encontrado (sha256sum/shasum)." >&2
      exit 1
    fi
  )
fi
# DrvFS/OneDrive pode expor todos os arquivos como 0777 e ignorar chmod.
# Normalizar no tar impede que MySQL descarte nodeaccess.cnf como world-writable
# e preserva executaveis porque apenas bits de escrita de grupo/outros saem.
tar --owner=0 --group=0 --numeric-owner --mode='go-w' -czf "$ARCHIVE_PATH" -C "$OUTPUT_ROOT" "$RELEASE_NAME"

PACKAGED_MYSQL_MODE="$(
  tar -tvzf "$ARCHIVE_PATH" "${RELEASE_NAME}/docker/mysql/conf.d/nodeaccess.cnf" \
    | awk '{print $1}'
)"
case "$PACKAGED_MYSQL_MODE" in
  ?????w????|????????w?)
    echo "Permissao insegura persistiu no pacote para docker/mysql/conf.d/nodeaccess.cnf: ${PACKAGED_MYSQL_MODE}" >&2
    exit 1
    ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$OUTPUT_ROOT"
    sha256sum "$(basename "$ARCHIVE_PATH")" > "$(basename "$CHECKSUMS_PATH")"
  )
elif command -v shasum >/dev/null 2>&1; then
  (
    cd "$OUTPUT_ROOT"
    shasum -a 256 "$(basename "$ARCHIVE_PATH")" > "$(basename "$CHECKSUMS_PATH")"
  )
else
  echo "Nenhum utilitario de checksum encontrado (sha256sum/shasum)." >&2
  exit 1
fi

echo "[nodeaccess] Release gerada com sucesso."
echo "- version: ${VERSION}"
echo "- release_dir: ${RELEASE_DIR}"
echo "- archive: ${ARCHIVE_PATH}"
echo "- checksums: ${CHECKSUMS_PATH}"
if [[ "$INCLUDE_OFFLINE_IMAGES" == "true" ]]; then
  echo "- offline_images: ${OFFLINE_BUNDLE_PATH}"
fi
if [[ "$BUILD_RELEASE_IMAGES" == "true" ]]; then
  echo "- backend_image: ${BACKEND_IMAGE_REF}"
  echo "- frontend_image: ${FRONTEND_IMAGE_REF}"
fi
