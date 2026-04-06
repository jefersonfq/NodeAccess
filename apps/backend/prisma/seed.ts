/**
 * Seed inicial — cria tenant padrão, licença e usuário admin.
 *
 * Executar: npm run db:seed -w apps/backend
 *
 * Credenciais geradas:
 *   E-mail:  admin@nodeaccess.local
 *   Senha:   Admin@1234  (forcePasswordChange = true → troca no primeiro acesso)
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  // Tenant padrão (slug 'default' é o fallback quando não há header X-Tenant-Slug)
  const tenant = await prisma.tenant.upsert({
    where:  { slug: 'default' },
    update: {},
    create: { name: 'NodeAccess', slug: 'default', active: true },
  })
  console.log(`✔ Tenant: ${tenant.name} (id=${tenant.id})`)

  // Licença
  await prisma.license.upsert({
    where:  { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      maxUsers: 300,
      active: true,
      maxActiveSessionsPerUser: 10,
      maxActiveSessionsTenant: 100,
    },
  })
  console.log('✔ Licença: 300 usuários | 10 sessões por usuário | 100 sessões por tenant')

  // Admin
  const passwordHash = await bcrypt.hash('Admin@1234', 12)
  const admin = await prisma.user.upsert({
    where:  { email: 'admin@nodeaccess.local' },
    update: {},
    create: {
      name:               'Administrador',
      email:              'admin@nodeaccess.local',
      passwordHash,
      role:               'ADMIN',
      tenantId:           tenant.id,
      mfaEnabled:         false,
      active:             true,
      canManageHosts:     true,
      licenseConsumed:    true,
      forcePasswordChange: true,
    },
  })
  console.log(`✔ Admin: ${admin.email}`)
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  E-mail : admin@nodeaccess.local')
  console.log('  Senha  : Admin@1234')
  console.log('  ⚠  Troque a senha no primeiro acesso!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
