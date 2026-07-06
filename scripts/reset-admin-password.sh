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

# Detecta o container da API (aceita prefixo variável do docker compose)
API_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E '(api|backend)' | grep -v 'ssh-gateway\|nginx\|frontend' | head -1)

if [ -z "$API_CONTAINER" ]; then
  echo "ERRO: Nenhum container da API encontrado em execução."
  echo "Verifique com: docker ps"
  exit 1
fi

echo "Container: $API_CONTAINER"
echo "Email    : $EMAIL"
echo "Senha    : *** (${#NEW_PASSWORD} chars)"
echo ""

docker exec "$API_CONTAINER" node -e "
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const hash = await bcrypt.hash('${NEW_PASSWORD}', 12);
  const result = await prisma.user.updateMany({
    where: { email: '${EMAIL}' },
    data:  { passwordHash: hash, forcePasswordChange: true },
  });
  if (result.count === 0) {
    console.error('ERRO: Nenhum usuário encontrado com email ${EMAIL}');
    process.exit(1);
  }
  console.log('Senha resetada com sucesso!');
  console.log('  Email : ${EMAIL}');
  console.log('  Rows  : ' + result.count);
  console.log('  Flag forcePasswordChange = true (troca exigida no primeiro login)');
  await prisma.\$disconnect();
})().catch(e => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
"
