#!/usr/bin/env node

require('dotenv').config({ path: 'apps/backend/.env' })

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const tenantSlug = process.env.LOADTEST_TENANT_SLUG || 'loadtest'
const enabled = process.env.LOADTEST_AUDIT_ENABLED !== '0'
const mode = enabled ? 'ALL' : 'DISABLED'

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } })
  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantSlug}`)
  }

  await prisma.license.upsert({
    where: { tenantId: tenant.id },
    update: {
      sessionAuditEnabled: enabled,
      active: true,
    },
    create: {
      tenantId: tenant.id,
      maxUsers: 300,
      active: true,
      sessionAuditEnabled: enabled,
      maxActiveSessionsPerUser: 200,
      maxActiveSessionsTenant: 1000,
    },
  })

  await prisma.sessionAuditPolicy.upsert({
    where: { tenantId: tenant.id },
    update: {
      enabled,
      mode,
    },
    create: {
      tenantId: tenant.id,
      enabled,
      mode,
    },
  })

  console.log(`Tenant: ${tenant.slug} id=${tenant.id}`)
  console.log(`Session audit licensed: ${enabled}`)
  console.log(`Session audit policy: ${mode}`)
  console.log('Gateway must run with FEATURE_SESSION_AUDIT=true for audit capture.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
