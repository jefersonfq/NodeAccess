import 'dotenv/config'
import { prisma } from '../src/config/database.js'
import { inspectEncryption } from '../src/shared/crypto.js'
import { prismaEncryptionInventorySources } from '../src/shared/encryption-inventory.prisma.js'
import { EncryptionInventoryService } from '../src/shared/encryption-inventory.service.js'

async function main(): Promise<void> {
  const service = new EncryptionInventoryService(
    prismaEncryptionInventorySources(prisma),
    { inspect: inspectEncryption },
  )
  const report = await service.inspect()
  process.stdout.write(`${JSON.stringify({ mode: 'read-only', ...report }, null, 2)}\n`)
  if (report.totals.invalid > 0) process.exitCode = 2
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Encryption inventory failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
