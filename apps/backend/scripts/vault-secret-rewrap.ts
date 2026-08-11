import 'dotenv/config'
import { prisma } from '../src/config/database.js'
import { inspectEncryption, rewrapEncryption } from '../src/shared/crypto.js'
import { PrismaVaultSecretRewrapRepository } from '../src/modules/secrets/vault-secret-rewrap.repository.js'
import { VaultSecretRewrapService } from '../src/modules/secrets/vault-secret-rewrap.service.js'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const expectedArg = [...args].find((arg) => arg.startsWith('--expected-previous='))
const confirmation = [...args].find((arg) => arg.startsWith('--confirm='))?.split('=')[1]

async function main(): Promise<void> {
  const service = new VaultSecretRewrapService(
    new PrismaVaultSecretRewrapRepository(prisma),
    { inspect: inspectEncryption, rewrap: rewrapEncryption },
  )
  if (!apply) {
    process.stdout.write(`${JSON.stringify(await service.dryRun(), null, 2)}\n`)
    return
  }
  const expectedPrevious = Number(expectedArg?.split('=')[1])
  if (!Number.isSafeInteger(expectedPrevious) || expectedPrevious < 0) {
    throw new Error('Use --expected-previous=<contagem do dry-run>')
  }
  if (confirmation !== 'REWRAP_VAULT_SECRETS') {
    throw new Error('Use --confirm=REWRAP_VAULT_SECRETS para autorizar a escrita')
  }
  process.stdout.write(`${JSON.stringify(await service.apply(expectedPrevious), null, 2)}\n`)
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Vault secret rewrap failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
