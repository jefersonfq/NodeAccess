import 'dotenv/config'
import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const BCRYPT_ROUNDS = 12

function parseArgs(argv) {
  const args = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item?.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args.set(key, next)
      i += 1
    } else {
      args.set(key, 'true')
    }
  }
  return args
}

function usage() {
  console.log(`Uso:
  npm run platform:create-superadmin -- --email admin@empresa.com --name "Admin Plataforma" --tenant-slug nodeaccess.com.br

Opcoes:
  --email                E-mail do superadmin. Obrigatorio.
  --name                 Nome do superadmin. Obrigatorio ao criar usuario novo.
  --tenant-slug          Slug do tenant de base para login. Padrao: default.
  --tenant-name          Nome do tenant se ele precisar ser criado. Padrao: NodeAccess Platform.
  --password             Senha inicial. Se omitida, gera senha temporaria forte.
  --reset-password       Reseta senha se o usuario ja existir. Padrao: false.
  --force-change         Obriga troca de senha no proximo login. Padrao: true.
`)
}

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL ausente. Carregue o .env correto antes de executar.')
    process.exit(1)
  }
}

function requireArg(args, key) {
  const value = args.get(key)
  if (!value) {
    console.error(`Informe --${key}`)
    usage()
    process.exit(1)
  }
  return value
}

function generateTemporaryPassword() {
  return `A1${randomBytes(12).toString('base64url')}`
}

async function ensureTenant(prisma, slug, name) {
  const existing = await prisma.tenant.findUnique({ where: { slug } })
  if (existing) {
    await prisma.inventoryNode.upsert({
      where: { rootTenantId: existing.id },
      update: {},
      create: {
        tenantId: existing.id,
        rootTenantId: existing.id,
        type: 'ROOT',
        name: '__root__',
        path: '/',
        depth: 0,
      },
    })
    if (!existing.active) {
      return prisma.tenant.update({ where: { id: existing.id }, data: { active: true } })
    }
    return existing
  }

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name, slug, active: true },
    })
    await tx.inventoryNode.create({
      data: {
        tenantId: tenant.id,
        rootTenantId: tenant.id,
        type: 'ROOT',
        name: '__root__',
        path: '/',
        depth: 0,
      },
    })
    await tx.license.create({
      data: {
        tenantId: tenant.id,
        maxUsers: 50,
        active: true,
      },
    })
    return tenant
  })
}

async function main() {
  requireDatabaseUrl()

  const args = parseArgs(process.argv.slice(2))
  if (args.get('help') === 'true') {
    usage()
    return
  }

  const email = requireArg(args, 'email').trim().toLowerCase()
  const name = args.get('name')?.trim()
  const tenantSlug = (args.get('tenant-slug') ?? 'default').trim().toLowerCase()
  const tenantName = args.get('tenant-name')?.trim() || 'NodeAccess Platform'
  const forceChange = args.get('force-change') !== 'false'
  const shouldResetPassword = args.get('reset-password') === 'true'
  const inputPassword = args.get('password')

  const prisma = new PrismaClient()
  try {
    const tenant = await ensureTenant(prisma, tenantSlug, tenantName)
    const existingUser = await prisma.user.findFirst({
      where: {
        email,
        tenantId: tenant.id,
        deletedAt: null,
      },
    })

    let temporaryPassword = null
    let passwordHash
    if (!existingUser || shouldResetPassword || inputPassword) {
      temporaryPassword = inputPassword || generateTemporaryPassword()
      passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS)
    }

    if (existingUser) {
      const updated = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: 'ADMIN',
          isPlatformAdmin: true,
          canManageHosts: true,
          active: true,
          licenseConsumed: true,
          forcePasswordChange: forceChange,
          failedLoginAttempts: 0,
          lockedUntil: null,
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: { id: true, email: true, tenantId: true },
      })

      console.log('Superadmin atualizado.')
      console.log(`- user_id: ${updated.id}`)
      console.log(`- email: ${updated.email}`)
      console.log(`- tenant_id: ${updated.tenantId}`)
      console.log(`- tenant_slug_login: ${tenantSlug}`)
    } else {
      if (!name) {
        console.error('Usuario novo exige --name.')
        process.exit(1)
      }
      const created = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: 'ADMIN',
          isPlatformAdmin: true,
          canManageHosts: true,
          active: true,
          licenseConsumed: true,
          forcePasswordChange: forceChange,
          tenantId: tenant.id,
        },
        select: { id: true, email: true, tenantId: true },
      })

      console.log('Superadmin criado.')
      console.log(`- user_id: ${created.id}`)
      console.log(`- email: ${created.email}`)
      console.log(`- tenant_id: ${created.tenantId}`)
      console.log(`- tenant_slug_login: ${tenantSlug}`)
    }

    console.log('- role: ADMIN')
    console.log('- platform_admin: sim')
    console.log(`- force_password_change: ${forceChange ? 'sim' : 'nao'}`)
    if (temporaryPassword) {
      console.log(`- temporary_password: ${temporaryPassword}`)
      console.log('Aviso: trate esta senha como sensivel e troque no primeiro login.')
    } else {
      console.log('- password: mantida')
      console.log('Dica: use --reset-password para gerar uma nova senha temporaria.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

await main()
