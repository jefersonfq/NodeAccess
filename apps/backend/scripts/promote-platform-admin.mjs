import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

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

const args = parseArgs(process.argv.slice(2))
const email = args.get('email')

if (!email) {
  console.error('Informe o e-mail: npm run platform:promote-admin -- --email admin@empresa.com')
  process.exit(1)
}

const prisma = new PrismaClient()

try {
  const updated = await prisma.$executeRaw`
    UPDATE users
    SET is_platform_admin = true
    WHERE email = ${email}
    LIMIT 1
  `

  if (updated === 0) {
    console.error(`Usuario nao encontrado para e-mail: ${email}`)
    process.exitCode = 1
  } else {
    console.log(`Platform admin ativado para: ${email}`)
  }
} catch (error) {
  console.error('Erro ao promover platform admin.')
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
