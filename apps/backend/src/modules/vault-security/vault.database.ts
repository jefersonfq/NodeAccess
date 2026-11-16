import { PrismaClient, type Prisma } from '@prisma/client'

export function vaultDatabaseUrl(source: string): string {
  try {
    const url = new URL(source)
    if (url.protocol !== 'mysql:') throw new Error('protocol')
    url.searchParams.set('connection_limit', '2')
    url.searchParams.set('pool_timeout', '1')
    return url.toString()
  } catch { throw new Error('Vault database configuration invalid') }
}
/** Lazy API-only pool: never consumes a central pool slot or connects from the gateway constructor. */
export class VaultDatabase {
  private database: PrismaClient | undefined
  private closing: Promise<void> | undefined
  constructor(private readonly source: string,
    private readonly create: (options: Prisma.PrismaClientOptions) => PrismaClient = options => new PrismaClient(options)) {}
  client(): PrismaClient {
    if (this.closing) throw new Error('Vault database closed')
    this.database ??= this.create({ datasources: { db: { url: vaultDatabaseUrl(this.source) } }, log: [] })
    return this.database
  }
  close(): Promise<void> {
    this.closing ??= this.database?.$disconnect() ?? Promise.resolve()
    return this.closing
  }
}
