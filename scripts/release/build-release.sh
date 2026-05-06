#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

VERSION="${1:-}"
OUTPUT_ROOT_INPUT="${2:-dist/releases}"
INCLUDE_OFFLINE_IMAGES="${INCLUDE_OFFLINE_IMAGES:-false}"
BACKEND_IMAGE="${BACKEND_IMAGE:-nodeaccess-backend}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-nodeaccess-frontend}"

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

mkdir -p "$RELEASE_DIR"

cp "${PROJECT_ROOT}/docker-compose.prod.yml" "${RELEASE_DIR}/docker-compose.prod.yml"
cp "${PROJECT_ROOT}/.env.example.prod" "${RELEASE_DIR}/.env.example.prod"
mkdir -p \
  "${RELEASE_DIR}/scripts/install" \
  "${RELEASE_DIR}/scripts/backup" \
  "${RELEASE_DIR}/scripts/deploy" \
  "${RELEASE_DIR}/scripts/release" \
  "${RELEASE_DIR}/apps/backend/scripts" \
  "${RELEASE_DIR}/docker/mysql/conf.d"
cp "${PROJECT_ROOT}/scripts/install/validate-env.sh" "${RELEASE_DIR}/scripts/install/validate-env.sh"
cp "${PROJECT_ROOT}/scripts/install/smoke-check.sh" "${RELEASE_DIR}/scripts/install/smoke-check.sh"
cp "${PROJECT_ROOT}/scripts/backup/backup-mysql.sh" "${RELEASE_DIR}/scripts/backup/backup-mysql.sh"
cp "${PROJECT_ROOT}/scripts/backup/restore-mysql.sh" "${RELEASE_DIR}/scripts/backup/restore-mysql.sh"
cp "${PROJECT_ROOT}/scripts/deploy/install-nodeaccess.sh" "${RELEASE_DIR}/scripts/deploy/install-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/deploy/update-nodeaccess.sh" "${RELEASE_DIR}/scripts/deploy/update-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/deploy/doctor-nodeaccess.sh" "${RELEASE_DIR}/scripts/deploy/doctor-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/deploy/rollback-nodeaccess.sh" "${RELEASE_DIR}/scripts/deploy/rollback-nodeaccess.sh"
cp "${PROJECT_ROOT}/scripts/deploy/switch-release.sh" "${RELEASE_DIR}/scripts/deploy/switch-release.sh"
cp "${PROJECT_ROOT}/scripts/deploy/prepare-nodeaccess-host.sh" "${RELEASE_DIR}/scripts/deploy/prepare-nodeaccess-host.sh"
cp "${PROJECT_ROOT}/scripts/deploy/install-from-tarball.sh" "${RELEASE_DIR}/scripts/deploy/install-from-tarball.sh"
cp "${PROJECT_ROOT}/scripts/deploy/generate-self-signed-cert.sh" "${RELEASE_DIR}/scripts/deploy/generate-self-signed-cert.sh"
cp "${PROJECT_ROOT}/apps/backend/scripts/recover-admin-access.mjs" "${RELEASE_DIR}/apps/backend/scripts/recover-admin-access.mjs"
cp "${PROJECT_ROOT}/docker/mysql/conf.d/"* "${RELEASE_DIR}/docker/mysql/conf.d/"
cp "${PROJECT_ROOT}/docker/nginx.http.conf" "${RELEASE_DIR}/docker/nginx.http.conf"
cp "${PROJECT_ROOT}/docker/nginx.https.conf" "${RELEASE_DIR}/docker/nginx.https.conf"

chmod +x \
  "${RELEASE_DIR}/scripts/install/validate-env.sh" \
  "${RELEASE_DIR}/scripts/install/smoke-check.sh" \
  "${RELEASE_DIR}/scripts/backup/backup-mysql.sh" \
  "${RELEASE_DIR}/scripts/backup/restore-mysql.sh" \
  "${RELEASE_DIR}/scripts/deploy/install-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/deploy/update-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/deploy/doctor-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/deploy/rollback-nodeaccess.sh" \
  "${RELEASE_DIR}/scripts/deploy/switch-release.sh" \
  "${RELEASE_DIR}/scripts/deploy/prepare-nodeaccess-host.sh" \
  "${RELEASE_DIR}/scripts/deploy/install-from-tarball.sh" \
  "${RELEASE_DIR}/scripts/deploy/generate-self-signed-cert.sh"

cat > "$VERSION_FILE" <<EOF
${VERSION}
EOF

cat > "$RELEASE_NOTES_FILE" <<EOF
# Release ${VERSION}

## Conteudo do pacote
- docker-compose.prod.yml
- .env.example.prod
- scripts/install/validate-env.sh
- scripts/install/smoke-check.sh
- scripts/deploy/install-nodeaccess.sh
- scripts/deploy/update-nodeaccess.sh
- scripts/deploy/doctor-nodeaccess.sh
- scripts/deploy/rollback-nodeaccess.sh
- scripts/deploy/switch-release.sh
- scripts/deploy/prepare-nodeaccess-host.sh
- scripts/deploy/install-from-tarball.sh
- scripts/deploy/generate-self-signed-cert.sh
- scripts/backup/backup-mysql.sh
- scripts/backup/restore-mysql.sh
- apps/backend/scripts/recover-admin-access.mjs
- docker/nginx.http.conf
- docker/nginx.https.conf
- docker/mysql/conf.d/*

## Checklist sugerida de upgrade
1. validar o .env com scripts/install/validate-env.sh
2. preparar host novo com scripts/deploy/prepare-nodeaccess-host.sh quando aplicavel
3. executar backup antes do upgrade
4. executar scripts/deploy/update-nodeaccess.sh
5. validar login admin, hosts, secrets e sessao SSH

## Observacoes
- preserve a mesma PEM_ENCRYPTION_KEY ao restaurar bancos existentes
- backend e frontend devem usar a mesma versao de release
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
    ".env.example.prod",
    "VERSION",
    "RELEASE-NOTES.md",
    "manifest.json",
    "scripts/install/validate-env.sh",
    "scripts/install/smoke-check.sh",
    "scripts/deploy/install-nodeaccess.sh",
    "scripts/deploy/update-nodeaccess.sh",
    "scripts/deploy/doctor-nodeaccess.sh",
    "scripts/deploy/rollback-nodeaccess.sh",
    "scripts/deploy/switch-release.sh",
    "scripts/deploy/prepare-nodeaccess-host.sh",
    "scripts/deploy/install-from-tarball.sh",
    "scripts/deploy/generate-self-signed-cert.sh",
    "scripts/backup/backup-mysql.sh",
    "scripts/backup/restore-mysql.sh",
    "apps/backend/scripts/recover-admin-access.mjs",
    "docker/nginx.http.conf",
    "docker/nginx.https.conf",
    "docker/mysql/conf.d/nodeaccess.cnf"
  ],
  "images": {
    "backend": "${BACKEND_IMAGE}:${VERSION}",
    "frontend": "${FRONTEND_IMAGE}:${VERSION}"
  },
  "offlineBundleIncluded": ${INCLUDE_OFFLINE_IMAGES}
}
EOF

if [[ "$INCLUDE_OFFLINE_IMAGES" == "true" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker nao encontrado no PATH para gerar bundle offline." >&2
    exit 1
  fi

  echo "[nodeaccess] Gerando bundle offline de imagens..."
  docker save "${BACKEND_IMAGE}:${VERSION}" "${FRONTEND_IMAGE}:${VERSION}" | gzip -c > "$OFFLINE_BUNDLE_PATH"
fi

rm -f "$ARCHIVE_PATH" "$CHECKSUMS_PATH"
tar -czf "$ARCHIVE_PATH" -C "$OUTPUT_ROOT" "$RELEASE_NAME"

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$OUTPUT_ROOT"
    sha256sum "$(basename "$ARCHIVE_PATH")" > "$(basename "$CHECKSUMS_PATH")"
    if [[ -f "${RELEASE_NAME}/${OFFLINE_BUNDLE_NAME}" ]]; then
      sha256sum "${RELEASE_NAME}/${OFFLINE_BUNDLE_NAME}" >> "$(basename "$CHECKSUMS_PATH")"
    fi
  )
elif command -v shasum >/dev/null 2>&1; then
  (
    cd "$OUTPUT_ROOT"
    shasum -a 256 "$(basename "$ARCHIVE_PATH")" > "$(basename "$CHECKSUMS_PATH")"
    if [[ -f "${RELEASE_NAME}/${OFFLINE_BUNDLE_NAME}" ]]; then
      shasum -a 256 "${RELEASE_NAME}/${OFFLINE_BUNDLE_NAME}" >> "$(basename "$CHECKSUMS_PATH")"
    fi
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
