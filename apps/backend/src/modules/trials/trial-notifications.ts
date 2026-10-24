import type { PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'

export type TrialNoticeKind = 'ready' | 'expiring'
export type TrialNoticeSender = (to: string, kind: TrialNoticeKind, expiresAt: Date) => Promise<void>
/** Durable, retryable operational mail. A crash after SMTP acceptance may deliver a duplicate. */
export async function deliverTrialNotices(db: PrismaClient, send: TrialNoticeSender, now = new Date()): Promise<void> {
  const ready = await db.trialRegistration.findMany({ where: {
    status: 'ACTIVE', email: { not: null }, expiresAt: { gt: now },
    notifications: { none: { kind: 'ready' } },
  }, take: 20, orderBy: { createdAt: 'asc' } })
  for (const trial of ready) await db.trialNotification.createMany({
    data: { id: `${trial.id}:ready`, trialId: trial.id, kind: 'ready' }, skipDuplicates: true })
  // Apply each profile's lead time before LIMIT so later, already-due trials cannot starve.
  const expiring = await db.$queryRaw<Array<{ id: string }>>`
    SELECT t.id FROM trial_registrations t
    WHERE t.status = 'ACTIVE' AND t.email IS NOT NULL AND t.expires_at > ${now}
      AND t.expires_at <= TIMESTAMPADD(HOUR,
        COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(t.profile_json, '$.expiryNoticeHours')) AS UNSIGNED), 6), ${now})
      AND NOT EXISTS (SELECT 1 FROM trial_notifications n WHERE n.trial_id = t.id AND n.kind = 'expiring')
    ORDER BY t.expires_at ASC LIMIT 20`
  for (const trial of expiring) {
    await db.trialNotification.createMany({
      data: { id: `${trial.id}:expiring`, trialId: trial.id, kind: 'expiring' }, skipDuplicates: true })
  }
  const pending = await db.trialNotification.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: now },
    OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: { nextAttemptAt: 'asc' }, take: 20 })
  for (const notice of pending) {
    const claimTime = new Date(Math.max(now.getTime(), Date.now()))
    const leaseUntil = new Date(claimTime.getTime() + 120000)
    const claimed = await db.trialNotification.updateMany({ where: { id: notice.id, status: 'PENDING', nextAttemptAt: { lte: claimTime },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: claimTime } }] }, data: { leaseUntil, attempts: { increment: 1 } } })
    if (!claimed.count) continue
    const fence = { id: notice.id, status: 'PENDING', leaseUntil }
    const current = await db.trialRegistration.findUnique({ where: { id: notice.trialId } })
    if (!current?.email || current.status !== 'ACTIVE' || !current.expiresAt || current.expiresAt <= claimTime) {
      await db.trialNotification.updateMany({ where: fence, data: { status: 'SKIPPED', leaseUntil: null } })
      continue
    }
    const noticeAt = new Date(current.expiresAt.getTime() - ((current.profileJson as { expiryNoticeHours?: number }).expiryNoticeHours ?? 6) * 3600_000)
    if (notice.kind === 'expiring' && noticeAt > claimTime) {
      await db.trialNotification.updateMany({ where: fence, data: { leaseUntil: null, nextAttemptAt: noticeAt } })
      continue
    }
    try {
      await send(current.email, notice.kind as TrialNoticeKind, current.expiresAt)
      await db.trialNotification.updateMany({ where: fence, data: { status: 'SENT', sentAt: new Date(Math.max(now.getTime(), Date.now())), leaseUntil: null } })
    } catch {
      await db.trialNotification.updateMany({ where: fence, data: {
        leaseUntil: null, nextAttemptAt: new Date(Math.max(now.getTime(), Date.now()) + Math.min(3600_000, 30000 * 2 ** Math.min(notice.attempts, 7))),
      } })
      logger.warn({ trialId: notice.trialId, kind: notice.kind }, 'Trial operational notification requires retry')
    }
  }
}
