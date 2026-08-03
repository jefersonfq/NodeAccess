#!/bin/bash
# Reseta a senha de um usuário admin no NodeAccess via container da API.
#
# Uso:
#   ./scripts/reset-admin-password.sh [email] [nova_senha]
#
# Exemplos:
#   ./scripts/reset-admin-password.sh
#   ./scripts/reset-admin-password.sh admin@nodeaccess.local MinhaSenha@123

set -euo pipefail

EMAIL="${1:-admin@nodeaccess.local}"
NEW_PASSWORD="${2:-Admin@1234}"

# Detecta somente a API do NodeAccess. Evita capturar containers de outros
# projetos que tambem tenham "api" ou "backend" no nome.
API_CONTAINER=$(docker ps --filter 'name=^/nodeaccess-api$' --format '{{.Names}}' | head -1)

if [ -z "$API_CONTAINER" ]; then
  API_CONTAINER=$(docker ps --format '{{.Names}}\t{{.Image}}\t{{.Label "com.docker.compose.service"}}\t{{.Label "com.docker.compose.project"}}' \
    | awk -F '\t' '$3 == "api" && ($1 ~ /(^|[-_])nodeaccess[-_]api$/ || $2 ~ /^nodeaccess-backend(:|$)/ || tolower($4) ~ /nodeaccess/) { print $1; exit }')
fi

if [ -z "$API_CONTAINER" ]; then
  echo "ERRO: Nenhum container da API encontrado em execução."
  echo "Esperado: container nodeaccess-api, service api do projeto NodeAccess ou imagem nodeaccess-backend."
  echo "Verifique com: docker ps --format '{{.Names}}  {{.Image}}'"
  exit 1
fi

echo "Container: $API_CONTAINER"
echo "Email    : $EMAIL"
echo "Senha    : *** (${#NEW_PASSWORD} chars)"
echo ""

docker exec \
  -e RESET_EMAIL="$EMAIL" \
  -e RESET_PASSWORD="$NEW_PASSWORD" \
  -w /app \
  "$API_CONTAINER" \
  node -e "
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const email = process.env.RESET_EMAIL;
  const password = process.env.RESET_PASSWORD;
  if (!email || !password) {
    console.error('ERRO: RESET_EMAIL/RESET_PASSWORD ausentes.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const result = await prisma.user.updateMany({
    where: { email },
    data:  { passwordHash: hash, forcePasswordChange: true },
  });
  if (result.count === 0) {
    console.error('ERRO: Nenhum usuário encontrado com email ' + email);
    process.exit(1);
  }
  console.log('Senha resetada com sucesso!');
  console.log('  Email : ' + email);
  console.log('  Rows  : ' + result.count);
  console.log('  Flag forcePasswordChange = true (troca exigida no primeiro login)');
  await prisma.\$disconnect();
})().catch(e => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
"
