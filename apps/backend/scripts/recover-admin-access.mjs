import 'dotenv/config'
import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const BCRYPT_ROUNDS = 12

function parseArgs(argv) {
  const args = new Map()
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item) continue
    if (!item.startsWith('--')) {
      positional.push(item)
      continue
    }
    const key = item.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args.set(key, next)
      i += 1
    } else {
      args.set(key, 'true')
    }
  }
  return { command: positional[0] ?? null, args }
}

function usage() {
  console.log(`Uso:
  npm run admin:recover -- promote --email admin@empresa.com
  npm run admin:recover -- reset-password --email admin@empresa.com --force-change
  npm run admin:recover -- clear-mfa --email admin@empresa.com --yes
  npm run admin:recover -- emergency --email admin@empresa.com --promote-platform-admin --reset-password --clear-mfa --force-change --yes
`)
}

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL ausente. Carregue o .env correto antes de executar.')
    process.exit(1)
  }
}

function getEmail(args) {
  const email = args.get('email')
  if (!email) {
    console.error('Informe --email usuario@empresa.com')
    process.exit(1)
  }
  return email
}

function generateTemporaryPassword() {
  return `A1${randomBytes(12).toString('base64url')}`
}

async function findUserOrExit(prisma, email) {
  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      tenantId: true,
      role: true,
      isPlatformAdmin: true,
      mfaEnabled: true,
    },
  })
  if (!user) {
    console.error(`Usuario nao encontrado para o e-mail: ${email}`)
    process.exit(1)
  }
  return user
}

async function promoteUser(prisma, user) {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      isPlatformAdmin: true,
      role: 'ADMIN',
      canManageHosts: true,
      active: true,
      licenseConsumed: true,
    },
    select: {
      id: true,
      role: true,
      isPlatformAdmin: true,
      canManageHosts: true,
    },
  })
  return updated
}

async function resetPassword(prisma, user, forceChange) {
  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      forcePasswordChange: forceChange,
      failedLoginAttempts: 0,
      lockedUntil: null,
      active: true,
      licenseConsumed: true,
    },
  })
  await prisma.authLog.create({
    data: {
      userId: user.id,
      eventType: 'PASSWORD_RESET',
      success: true,
      userAgent: 'recover-admin-access.mjs',
      ip: '127.0.0.1',
    },
  }).catch(() => {})
  return temporaryPassword
}

async function clearMfa(prisma, user) {
  await prisma.user.update({
    where: { id: user.id },
    data: {
      mfaSecret: null,
      mfaEnabled: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  })
}

async function main() {
  requireDatabaseUrl()

  const { command, args } = parseArgs(process.argv.slice(2))
  if (!command) {
    usage()
    process.exit(1)
  }

  const prisma = new PrismaClient()
  try {
    const email = getEmail(args)
    const user = await findUserOrExit(prisma, email)
    const forceChange = args.get('force-change') !== 'false'
    const yes = args.get('yes') === 'true'

    let promoted = false
    let temporaryPassword = null
    let mfaCleared = false

    if (command === 'promote') {
      await promoteUser(prisma, user)
      promoted = true
    } else if (command === 'reset-password') {
      temporaryPassword = await resetPassword(prisma, user, forceChange)
    } else if (command === 'clear-mfa') {
      if (!yes) {
        console.error('Use --yes para confirmar a limpeza de MFA.')
        process.exit(1)
      }
      await clearMfa(prisma, user)
      mfaCleared = true
    } else if (command === 'emergency') {
      if (args.get('promote-platform-admin') === 'true') {
        await promoteUser(prisma, user)
        promoted = true
      }
      if (args.get('reset-password') === 'true') {
        temporaryPassword = await resetPassword(prisma, user, forceChange)
      }
      if (args.get('clear-mfa') === 'true') {
        if (!yes) {
          console.error('Use --yes para confirmar a limpeza de MFA no modo emergency.')
          process.exit(1)
        }
        await clearMfa(prisma, user)
        mfaCleared = true
      }
      if (!promoted && !temporaryPassword && !mfaCleared) {
        console.error('Nenhuma acao foi solicitada para o modo emergency.')
        process.exit(1)
      }
    } else {
      usage()
      process.exit(1)
    }

    const refreshedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        tenantId: true,
        role: true,
        isPlatformAdmin: true,
        mfaEnabled: true,
        forcePasswordChange: true,
        active: true,
      },
    })

    console.log('Recuperacao administrativa concluida.')
    console.log(`- usuario: ${refreshedUser.email}`)
    console.log(`- tenant_id: ${refreshedUser.tenantId}`)
    console.log(`- role: ${refreshedUser.role}`)
    console.log(`- platform_admin: ${refreshedUser.isPlatformAdmin ? 'sim' : 'nao'}`)
    console.log(`- mfa_enabled: ${refreshedUser.mfaEnabled ? 'sim' : 'nao'}`)
    console.log(`- force_password_change: ${refreshedUser.forcePasswordChange ? 'sim' : 'nao'}`)
    console.log(`- active: ${refreshedUser.active ? 'sim' : 'nao'}`)
    if (temporaryPassword) {
      console.log(`- temporary_password: ${temporaryPassword}`)
      console.log('Aviso: troque a senha no primeiro login e trate este valor como sensivel.')
    }
    if (mfaCleared) {
      console.log('Aviso: o MFA foi limpo. Reconfigure-o imediatamente apos recuperar o acesso.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

await main()
