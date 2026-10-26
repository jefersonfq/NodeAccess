import { logger } from '../../config/logger.js'
import type { Prisma, PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { env } from '../../config/env.js'
import { rm } from 'node:fs/promises'
import path from 'node:path'

/** Explicit tenant predicates also cover stores without relational cascades. */
async function purgeTenantDomains(tx: Prisma.TransactionClient, tenantId: number): Promise<void> {
  // Refuse malformed cross-tenant credential references instead of modifying a normal tenant.
  const sharedKey = await tx.pemKey.findFirst({ where: { createdBy: { tenantId }, OR: [
    { hosts: { some: { tenantId: { not: tenantId } } } }, { bastionHosts: { some: { tenantId: { not: tenantId } } } },
  ] }, select: { id: true } })
  const sharedSecret = await tx.secret.findFirst({ where: { tenantId, passwordHosts: { some: { tenantId: { not: tenantId } } } }, select: { id: true } })
  const sharedBastion = await tx.bastionHost.findFirst({ where: { tenantId, OR: [
    { hosts: { some: { tenantId: { not: tenantId } } } }, { groups: { some: { tenantId: { not: tenantId } } } },
  ] }, select: { id: true } })
  if (sharedKey || sharedSecret || sharedBastion) throw new Error('CROSS_TENANT_CREDENTIAL_REFERENCE')
  const bastionKeys = await tx.bastionPemKey.findMany({ where: { bastionHosts: { some: { tenantId }, every: { tenantId } } }, select: { id: true } })
  const diagnosticRuns = await tx.diagnosticRun.findMany({ where: { tenantId }, select: { id: true } })
  const actionRuns = await tx.aiSshActionRun.findMany({ where: { tenantId }, select: { id: true } })
  const jira = await tx.jiraInteraction.findMany({ where: { tenantId }, select: { id: true } })
  await tx.diagnosticRunCommand.deleteMany({ where: { runId: { in: diagnosticRuns.map(row => row.id) } } })
  await tx.aiSshActionRunStep.deleteMany({ where: { runId: { in: actionRuns.map(row => row.id) } } })
  await tx.jiraInteractionSession.deleteMany({ where: { interactionId: { in: jira.map(row => row.id) } } })
  await tx.sharedSession.deleteMany({ where: { tenantId } })
  await tx.snippetExecutionEvent.deleteMany({ where: { tenantId } })
  await tx.mcpInteractiveSshSession.deleteMany({ where: { tenantId } })
  await tx.session.deleteMany({ where: { host: { tenantId } } })
  await tx.authLog.deleteMany({ where: { user: { tenantId } } })
  await tx.adminLog.deleteMany({ where: { admin: { tenantId } } })
  await tx.localAccessEvent.deleteMany({ where: { tenantId } })
  await tx.portForwarding.deleteMany({ where: { host: { tenantId } } })
  await tx.hostLink.deleteMany({ where: { tenantId } })
  await tx.hostAssociatedLink.deleteMany({ where: { tenantId } })
  await tx.hostPersonalFolder.deleteMany({ where: { tenantId } })
  await tx.hostTag.deleteMany({ where: { host: { tenantId } } })
  await tx.resourceAclEntry.deleteMany({ where: { tenantId } })
  await tx.userGroup.deleteMany({ where: { user: { tenantId } } })
  await tx.terminalHighlightAssignment.deleteMany({ where: { user: { tenantId } } })
  await tx.terminalHighlightGroupAssignment.deleteMany({ where: { group: { tenantId } } })
  await tx.sessionAuditPolicyUser.deleteMany({ where: { user: { tenantId } } })
  await tx.sessionAuditPolicyGroup.deleteMany({ where: { group: { tenantId } } })
  // Clear references on retained tombstones before deleting credentials and hierarchy.
  await tx.host.updateMany({ where: { tenantId }, data: { pemKeyId: null, passwordSecretId: null, bastionId: null,
    folderId: null, groupId: null, onePasswordRef: null, startupSnippetId: null, startupSnippetMode: 'DISABLED',
    privateAccessConnectorId: null, trustedHostKeyVerifiedAt: null, trustedHostKeyVerifiedBy: null, deviceProfile: null } })
  await tx.group.updateMany({ where: { tenantId }, data: { bastionId: null } })
  await tx.folder.updateMany({ where: { tenantId }, data: { parentId: null } })
  await tx.webhookDelivery.deleteMany({ where: { tenantId } })
  await tx.webhookSubscription.deleteMany({ where: { tenantId } })
  await tx.webhookEventOutbox.deleteMany({ where: { tenantId } })
  await tx.inboundWebhookReceipt.deleteMany({ where: { tenantId } })
  await tx.inboundWebhookEndpoint.deleteMany({ where: { tenantId } })
  await tx.networkTacacsEvent.deleteMany({ where: { tenantId } })
  await tx.networkTacacsGrant.deleteMany({ where: { tenantId } })
  await tx.networkTacacsCredential.deleteMany({ where: { tenantId } })
  await tx.networkTacacsDevice.deleteMany({ where: { tenantId } })
  await tx.networkSettings.deleteMany({ where: { tenantId } })
  await tx.haAgentJob.deleteMany({ where: { tenantId } })
  await tx.haOperation.deleteMany({ where: { tenantId } })
  await tx.haNode.deleteMany({ where: { tenantId } })
  await tx.nativeSshGatewayConfig.deleteMany({ where: { tenantId } })
  await tx.externalIdentityLinkRequest.deleteMany({ where: { tenantId } })
  await tx.externalIdentity.deleteMany({ where: { tenantId } })
  await tx.oidcGroupMapping.deleteMany({ where: { tenantId } })
  await tx.scimAuditEvent.deleteMany({ where: { tenantId } })
  await tx.scimUser.deleteMany({ where: { tenantId } })
  await tx.scimGroup.deleteMany({ where: { tenantId } })
  await tx.scimConfig.deleteMany({ where: { tenantId } })
  await tx.tenantAuthPolicy.deleteMany({ where: { tenantId } })
  await tx.terminalHighlightTelemetry.deleteMany({ where: { tenantId } })
  await tx.terminalHighlightPreference.deleteMany({ where: { tenantId } })
  await tx.terminalHighlightTemplateVersion.deleteMany({ where: { tenantId } })
  await tx.terminalHighlightTemplate.deleteMany({ where: { tenantId } })
  await tx.localAiProposedAction.deleteMany({ where: { tenantId } })
  await tx.localAiKnowledgeDocument.deleteMany({ where: { tenantId } })
  await tx.localAiProviderUsageDaily.deleteMany({ where: { tenantId } })
  await tx.localAiBudgetCounter.deleteMany({ where: { tenantId } })
  await tx.aiInvestigation.deleteMany({ where: { tenantId } })
  await tx.aiScriptArtifact.deleteMany({ where: { tenantId } })
  await tx.aiSshActionRun.deleteMany({ where: { tenantId } })
  await tx.diagnosticRun.deleteMany({ where: { tenantId } })
  await tx.diagnosticPlaybook.deleteMany({ where: { tenantId } })
  await tx.aiInteraction.deleteMany({ where: { tenantId } })
  await tx.jiraOutboxEvent.deleteMany({ where: { tenantId } })
  await tx.jiraInteraction.deleteMany({ where: { tenantId } })
  await tx.hostImportJob.deleteMany({ where: { tenantId } })
  await tx.hostBulkActionHistory.deleteMany({ where: { tenantId } })
  await tx.integration.deleteMany({ where: { tenantId } })
  await tx.emailConfig.deleteMany({ where: { tenantId } })
  await tx.feedback.deleteMany({ where: { tenantId } })
  await tx.mcpToken.deleteMany({ where: { tenantId } })
  await tx.agent.deleteMany({ where: { tenantId } })
  await tx.sessionCommandPolicyGroup.deleteMany({ where: { tenantId } })
  await tx.aiSshActionCommandPolicy.deleteMany({ where: { tenantId } })
  await tx.sessionAuditPolicy.deleteMany({ where: { tenantId } })
  await tx.snippet.deleteMany({ where: { tenantId } })
  await tx.snippetGroup.deleteMany({ where: { tenantId } })
  await tx.secret.deleteMany({ where: { tenantId } })
  await tx.bastionHost.deleteMany({ where: { tenantId } })
  await tx.folder.deleteMany({ where: { tenantId } })
  await tx.tag.deleteMany({ where: { tenantId } })
  await tx.group.deleteMany({ where: { tenantId } })
  await tx.tenantManualSettings.deleteMany({ where: { tenantId } })
  await tx.license.deleteMany({ where: { tenantId } })
  await tx.pemKey.deleteMany({ where: { createdBy: { tenantId }, hosts: { none: {} }, bastionHosts: { none: {} } } })
  await tx.bastionPemKey.deleteMany({ where: { id: { in: bastionKeys.map(row => row.id) }, bastionHosts: { none: {} } } })
}

/** Scoped retention of trial data only. Backups/exports require their separate retention schedule. */
export async function purgeExpiredTrialData(db: PrismaClient, auditRoot: string, now = new Date(), avatarRoot = env.USER_AVATAR_STORAGE_DIR): Promise<number> {
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
      const completed = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${trial.id} FOR UPDATE`
        const current = await tx.trialRegistration.findUniqueOrThrow({ where: { id: trial.id } })
        if (current.status !== 'REMOVED' || !current.email) return false
        const currentDays = (current.profileJson as { retentionDays?: unknown }).retentionDays
        if (typeof currentDays !== 'number' || !Number.isInteger(currentDays) || currentDays < 1 || currentDays > 365 || !current.closedAt || current.closedAt.getTime() + currentDays * 86400_000 > now.getTime()) return false
        if (current.tenantId) {
          if (!Number.isSafeInteger(current.tenantId) || current.tenantId < 1) throw new Error('INVALID_TRIAL_TENANT')
          const tenantHash = createHash('sha256').update(String(current.tenantId)).digest('hex').slice(0, 16)
          await rm(path.join(path.resolve(avatarRoot), tenantHash), { recursive: true, force: true })
          const sessions = await tx.session.findMany({ where: { host: { tenantId: current.tenantId } }, select: { id: true } })
          // Derive paths from database session IDs, never an uploaded path/storageKey.
          for (const session of sessions) {
            if (!Number.isSafeInteger(session.id) || session.id < 1) throw new Error('INVALID_TRIAL_SESSION')
            await rm(path.join(path.resolve(auditRoot), String(session.id)), { recursive: true, force: true })
          }
        }
        if (current.tenantId) {
          const tenantId = current.tenantId
          await purgeTenantDomains(tx, tenantId)
          const users = await tx.user.findMany({ where: { tenantId }, select: { id: true } })
          for (const user of users) await tx.user.update({ where: { id: user.id }, data: {
            name: 'Participante removido', email: `removed-${user.id}@invalid.local`, passwordHash: null,
            mfaSecret: null, mfaEnabled: false, preferencesJson: {}, googleId: null, avatarMimeType: null, avatarUpdatedAt: null,
            sessionVersion: { increment: 1 }, active: false, deletedAt: now,
          } })
          await tx.inventoryNode.updateMany({ where: { tenantId }, data: { name: 'Recurso removido', path: '/', deletedAt: now, createdById: null, updatedById: null } })
          await tx.host.updateMany({ where: { tenantId }, data: { name: 'Laboratório removido', description: null,
            ip: '0.0.0.0', sshUser: 'removed', passwordEncrypted: null, trustedHostKeyFingerprint: null, deletedAt: now } })
          await tx.tenant.update({ where: { id: tenantId }, data: { name: 'Teste encerrado', slug: `removed-trial-${tenantId}`, active: false } })
        }
        await tx.trialNotification.deleteMany({ where: { trialId: trial.id } })
        await tx.trialParticipant.deleteMany({ where: { trialId: trial.id } })
        await tx.trialConsentEvent.deleteMany({ where: { trialId: trial.id } })
        // Keep the minimized classification tombstone (pseudonymous, not certified anonymous) so disabling onboarding cannot turn it into production.
        await tx.trialRegistration.update({ where: { id: trial.id }, data: { email: null, phoneEncrypted: null, name: 'Removido', lastError: null,
          verificationHash: null, managementHash: null, marketingConsent: false, researchConsent: false } })
        return true
      }, { timeout: 30_000 })
      if (completed) purged++
    } catch {
      await db.trialRegistration.updateMany({ where: { id: trial.id, status: 'REMOVED' }, data: { updatedAt: now, lastError: 'RETENTION_RETRY' } }).catch(() => undefined)
      logger.warn({ trialId: trial.id }, 'Trial retention requires retry')
    }
  }
  return purged
}
