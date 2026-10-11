import type { PrismaClient, Prisma } from '@prisma/client'
import { LicenseLimitError } from './errors.js'

/** All consumers lock the same tenant row, including OIDC JIT and SCIM. */
export async function withUserSlot<T>(db: PrismaClient, tenantId: number, operation: (tx: Prisma.TransactionClient) => Promise<T>, currentUserId?: number): Promise<T> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`
    const current = currentUserId === undefined ? null : await tx.user.findUnique({ where: { id: currentUserId } })
    const alreadyCounted = current?.tenantId === tenantId && current.active && current.licenseConsumed && !current.deletedAt
    if (!alreadyCounted) {
      const license = await tx.license.findUnique({ where: { tenantId } })
      const used = await tx.user.count({ where: { tenantId, active: true, licenseConsumed: true, deletedAt: null } })
      if (license && used >= license.maxUsers) throw new LicenseLimitError()
    }
    return operation(tx)
  }, { isolationLevel: 'ReadCommitted' })
}
