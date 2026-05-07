#!/usr/bin/env node

require('dotenv').config({ path: 'apps/backend/.env' })

const crypto = require('node:crypto')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const TENANT_SLUG = process.env.LOADTEST_TENANT_SLUG || 'loadtest'
const TOKEN_VALUE = process.env.LOADTEST_MCP_TOKEN || `na_mcp_loadtest_${crypto.randomBytes(24).toString('hex')}`
const TOKEN_NAME = process.env.LOADTEST_MCP_TOKEN_NAME || 'Loadtest MCP interactive full access'
const ADMIN_EMAIL = process.env.LOADTEST_MCP_ADMIN_EMAIL || 'loadtest-mcp-admin@nodeaccess.local'

const INTERACTIVE_CAPABILITIES = [
  'open_interactive_ssh_session',
  'write_interactive_ssh_session',
  'read_interactive_ssh_session',
  'resize_interactive_ssh_session',
  'close_interactive_ssh_session',
]

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function mergeEntitlements(current) {
  const parsed = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
  return {
    ...parsed,
    mcp: true,
    aiSshActions: true,
  }
}

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true },
  })
  if (!tenant) {
    throw new Error(`Tenant ${TENANT_SLUG} nao encontrado. Rode seed-local-loadtest antes.`)
  }

  const host = await prisma.host.findFirst({
    where: { tenantId: tenant.id, name: { startsWith: 'loadtest-mock-' } },
    orderBy: { id: 'asc' },
    select: { id: true, name: true },
  })
  if (!host) {
    throw new Error(`Nenhum host loadtest-mock encontrado no tenant ${TENANT_SLUG}. Rode seed-local-loadtest antes.`)
  }

  const license = await prisma.license.findUnique({
    where: { tenantId: tenant.id },
    select: { featureEntitlementsJson: true },
  })
  await prisma.license.update({
    where: { tenantId: tenant.id },
    data: {
      active: true,
      featureEntitlementsJson: mergeEntitlements(license?.featureEntitlementsJson),
    },
  })

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      tenantId: tenant.id,
      active: true,
      role: 'ADMIN',
      canManageHosts: true,
      forcePasswordChange: false,
      licenseConsumed: true,
    },
    create: {
      name: 'Loadtest MCP Admin',
      email: ADMIN_EMAIL,
      tenantId: tenant.id,
      active: true,
      role: 'ADMIN',
      canManageHosts: true,
      forcePasswordChange: false,
      licenseConsumed: true,
    },
    select: { id: true, email: true },
  })

  const tokenHash = hashToken(TOKEN_VALUE)
  await prisma.mcpToken.upsert({
    where: { tokenHash },
    update: {
      tenantId: tenant.id,
      createdById: admin.id,
      name: TOKEN_NAME,
      allowedCapabilitiesJson: INTERACTIVE_CAPABILITIES,
      allowedActionModesJson: ['full_operational_access'],
      allowedHostIdsJson: [host.id],
      active: true,
      expiresAt: null,
      revokedAt: null,
      revokedById: null,
    },
    create: {
      tenantId: tenant.id,
      createdById: admin.id,
      name: TOKEN_NAME,
      tokenHash,
      allowedCapabilitiesJson: INTERACTIVE_CAPABILITIES,
      allowedActionModesJson: ['full_operational_access'],
      allowedHostIdsJson: [host.id],
      active: true,
    },
  })

  console.log(`Tenant: ${tenant.slug} id=${tenant.id}`)
  console.log(`Admin: ${admin.email} id=${admin.id}`)
  console.log(`Host: ${host.name} id=${host.id}`)
  console.log(`MCP token: ${TOKEN_VALUE}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
