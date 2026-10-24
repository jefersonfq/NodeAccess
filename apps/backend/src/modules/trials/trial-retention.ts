import { revokeTrialPemKeys } from './trial-custom-hosts.js'
import { logger } from '../../config/logger.js'
import type { PrismaClient } from '@prisma/client'
import { rm } from 'node:fs/promises'
import path from 'node:path'

/** Scoped retention of trial data only. Backups/exports require their separate retention schedule. */
export async function purgeExpiredTrialData(db: PrismaClient, auditRoot: string, now = new Date()): Promise<number> {
  const due = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM trial_registrations
    WHERE status = 'REMOVED' AND email IS NOT NULL AND closed_at IS NOT NULL
    AND CAST(JSON_UNQUOTE(JSON_EXTRACT(profile_json, '$.retentionDays')) AS UNSIGNED) BETWEEN 1 AND 365
    AND DATE_ADD(closed_at, INTERVAL CAST(JSON_UNQUOTE(JSON_EXTRACT(profile_json, '$.retentionDays')) AS UNSIGNED) DAY) <= ${now}
    ORDER BY updated_at ASC LIMIT 50`
  const candidates = await db.trialRegistration.findMany({ where: { id: { in: due.map(row => row.id) } } })
  let purged = 0
  for (const trial of candidates) {
    try {
    const days = (trial.profileJson as { retentionDays?: unknown }).retentionDays
    if (typeof days !== 'number' || days < 1 || !trial.closedAt || trial.closedAt.getTime() + days * 86400_000 > now.getTime()) continue
    if (trial.tenantId) {
      const sessions = await db.session.findMany({ where: { host: { tenantId: trial.tenantId } }, select: { id: true } })
      // Derive paths from database session IDs, never an uploaded path/storageKey.
      for (const session of sessions) {
        if (!Number.isSafeInteger(session.id) || session.id < 1) throw new Error('INVALID_TRIAL_SESSION')
        await rm(path.join(path.resolve(auditRoot), String(session.id)), { recursive: true, force: true })
      }
    }
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${trial.id} FOR UPDATE`
      const current = await tx.trialRegistration.findUniqueOrThrow({ where: { id: trial.id } })
      if (current.status !== 'REMOVED' || !current.email) return
      if (current.tenantId) {
        const tenantId = current.tenantId
        await revokeTrialPemKeys(tx, tenantId)
        // These are the only write-enabled trial domains; FK cascades remove derived evidence.
        await tx.sharedSession.deleteMany({ where: { tenantId } })
        await tx.snippetExecutionEvent.deleteMany({ where: { tenantId } })
        await tx.session.deleteMany({ where: { host: { tenantId } } })
        await tx.authLog.deleteMany({ where: { user: { tenantId } } })
        await tx.adminLog.deleteMany({ where: { admin: { tenantId } } })
        const users = await tx.user.findMany({ where: { tenantId }, select: { id: true } })
        for (const user of users) await tx.user.update({ where: { id: user.id }, data: {
          name: 'Participante removido', email: `removed-${user.id}@invalid.local`, passwordHash: null,
          mfaSecret: null, preferencesJson: {}, googleId: null, active: false, deletedAt: now,
        } })
        await tx.inventoryNode.updateMany({ where: { tenantId, type: 'HOST' }, data: { name: 'Recurso removido' } })
        await tx.host.updateMany({ where: { tenantId }, data: { name: 'Laboratório removido', description: null,
          ip: '0.0.0.0', sshUser: 'removed', passwordEncrypted: null, trustedHostKeyFingerprint: null, deletedAt: now } })
        await tx.tenant.update({ where: { id: tenantId }, data: { name: 'Degustação encerrada', active: false } })
      }
      await tx.trialNotification.deleteMany({ where: { trialId: trial.id } })
      await tx.trialParticipant.deleteMany({ where: { trialId: trial.id } })
      await tx.trialConsentEvent.deleteMany({ where: { trialId: trial.id } })
      // Keep the minimized classification tombstone (pseudonymous, not certified anonymous) so disabling onboarding cannot turn it into production.
      await tx.trialRegistration.update({ where: { id: trial.id }, data: { email: null, phoneEncrypted: null, name: 'Removido', lastError: null,
        verificationHash: null, managementHash: null, marketingConsent: false, researchConsent: false } })
      purged++
    })
    } catch {
      await db.trialRegistration.updateMany({ where: { id: trial.id, status: 'REMOVED' }, data: { updatedAt: now, lastError: 'RETENTION_RETRY' } }).catch(() => undefined)
      logger.warn({ trialId: trial.id }, 'Trial retention requires retry')
    }
  }
  return purged
}
