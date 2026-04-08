import 'dotenv/config'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const apply = process.argv.includes('--apply')
const tenantSlug = process.env.TENANT_SLUG?.trim() || 'default'

function readBool(name, fallback = false) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function readInt(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readOptionalInt(name) {
  const value = process.env[name]
  if (value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function hashLicenseKey(value) {
  if (!value) return null
  return createHash('sha256').update(value).digest('hex')
}

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    include: { license: true },
  })

  if (!tenant) {
    console.error(`Tenant "${tenantSlug}" nao encontrado. Rode o seed ou informe TENANT_SLUG.`)
    process.exitCode = 2
    return
  }

  const desiredLicense = {
    tenantId: tenant.id,
    maxUsers: readInt('LICENSE_MAX_USERS', 300),
    multiConnect: readBool('LICENSE_MULTI_CONNECT', false),
    maxActiveSessionsPerUser: readOptionalInt('SESSION_MAX_ACTIVE_PER_USER'),
    maxActiveSessionsTenant: readOptionalInt('SESSION_MAX_ACTIVE_PER_TENANT'),
    keyHash: hashLicenseKey(process.env.LICENSE_KEY),
    active: true,
  }

  console.log(`Tenant: ${tenant.name} (${tenant.slug}, id=${tenant.id})`)

  if (tenant.license) {
    console.log('Licenca ja existe no banco. Nenhuma alteracao aplicada para evitar impacto funcional.')
    console.log({
      maxUsers: tenant.license.maxUsers,
      multiConnect: tenant.license.multiConnect,
      sessionAuditEnabled: tenant.license.sessionAuditEnabled,
      sessionAuditAiEnabled: tenant.license.sessionAuditAiEnabled,
      maxActiveSessionsPerUser: tenant.license.maxActiveSessionsPerUser,
      maxActiveSessionsTenant: tenant.license.maxActiveSessionsTenant,
      active: tenant.license.active,
    })
    return
  }

  console.log('Licenca ausente. Valores nao sensiveis que seriam inseridos:')
  console.log({
    maxUsers: desiredLicense.maxUsers,
    multiConnect: desiredLicense.multiConnect,
    maxActiveSessionsPerUser: desiredLicense.maxActiveSessionsPerUser,
    maxActiveSessionsTenant: desiredLicense.maxActiveSessionsTenant,
    hasLicenseKey: !!desiredLicense.keyHash,
    active: desiredLicense.active,
  })

  if (!apply) {
    console.log('Dry-run: nada foi gravado. Use -- --apply para inserir.')
    return
  }

  await prisma.license.create({ data: desiredLicense })
  console.log('Licenca criada no banco.')
}

main()
  .catch((err) => {
    if (err?.name === 'PrismaClientInitializationError') {
      console.error('Nao foi possivel conectar ao banco. Suba o MySQL/API antes de sincronizar configuracoes.')
      console.error('Em dev, use: docker compose up -d --build')
    } else {
      console.error(err)
    }
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
