import type { Prisma } from '@prisma/client'
import { trialDenied } from './trial-policy.js'

/** All trial user writers reserve under trial row, then tenant row (same order). */
export async function assertTrialUserSlot(tx: Prisma.TransactionClient, tenantId: number, reservationId?: string, currentUserId?: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM trial_registrations WHERE tenant_id = ${tenantId} FOR UPDATE`
  const trial = await tx.trialRegistration.findUnique({ where: { tenantId } })
  if (!trial || trial.status !== 'ACTIVE' || !trial.expiresAt || trial.expiresAt.getTime() <= Date.now()) throw trialDenied()
  const max = (trial.profileJson as { maxUsers?: number }).maxUsers
  if (!Number.isSafeInteger(max) || !max) throw trialDenied('TRIAL_CAPACITY_UNAVAILABLE')
  const users = await tx.user.count({ where: { tenantId, active: true, deletedAt: null, ...(currentUserId ? { id: { not: currentUserId } } : {}) } })
  const reservations = await tx.trialParticipant.count({ where: { trialId: trial.id, cancelledAt: null, activatedAt: null,
    ...(reservationId ? { id: { not: reservationId } } : {}), OR: [{ verifiedAt: { not: null } }, { verificationExpiresAt: { gt: new Date() } }] } })
  if (users + reservations >= max) throw trialDenied('TRIAL_USER_LIMIT')
}
