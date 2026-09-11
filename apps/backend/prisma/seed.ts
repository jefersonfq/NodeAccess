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
  const existingAdmin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: 'admin@nodeaccess.local', deletedAt: null },
  })
  const adminData = {
      name:               'Administrador',
      email:              'admin@nodeaccess.local',
      passwordHash,
      role:               'ADMIN',
      tenantId:           tenant.id,
      isPlatformAdmin:    true,
      mfaEnabled:         false,
      active:             true,
      canManageHosts:     true,
      licenseConsumed:    true,
      forcePasswordChange: true,
  } as const
  const admin = existingAdmin
    ? await prisma.user.update({ where: { id: existingAdmin.id }, data: adminData })
    : await prisma.user.create({ data: adminData })

  const inventoryRoot = await prisma.inventoryNode.upsert({
    where: { rootTenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      rootTenantId: tenant.id,
      type: 'ROOT',
      name: '__root__',
      path: '/',
      depth: 0,
    },
  })
  await prisma.resourceAclEntry.upsert({
    where: {
      inventoryNodeId_principalType_principalId: {
        inventoryNodeId: inventoryRoot.id,
        principalType: 'ROLE',
        principalId: 2,
      },
    },
    update: {
      canView: true,
      canConnect: true,
      canEdit: true,
      canAdmin: true,
      inheritToChildren: true,
    },
    create: {
      tenantId: tenant.id,
      inventoryNodeId: inventoryRoot.id,
      principalType: 'ROLE',
      principalId: 2,
      canView: true,
      canConnect: true,
      canEdit: true,
      canAdmin: true,
      inheritToChildren: true,
      createdById: admin.id,
    },
  })
  console.log(`✔ Admin: ${admin.email}`)
  console.log(`✔ Inventário corporativo: raiz id=${inventoryRoot.id} com ACL administrativa`)
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
