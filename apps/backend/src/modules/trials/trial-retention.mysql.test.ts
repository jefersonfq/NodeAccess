import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { encrypt } from '../../shared/crypto.js'
import { purgeExpiredTrialData } from './trial-retention.js'

const connection = process.env.TRIAL_RETENTION_DATABASE_URL
const real = connection ? describe : describe.skip
real('trial retention against isolated MySQL foreign keys and real files', () => {
  let db: PrismaClient
  let root: string
  const tenantIds: number[] = []
  const now = new Date('2030-01-10T12:00:00Z')
  const old = new Date('2030-01-01T12:00:00Z')
  beforeAll(async () => {
    const url = new URL(connection!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['/na0068_retention', '/na0068_retention_zodreview', '/na0068_phone', '/na0074_retention'].includes(url.pathname)) throw new Error('This suite only accepts the isolated local na0068_retention schema')
    db = new PrismaClient({ datasourceUrl: connection! })
    await db.$connect()
    root = await mkdtemp(path.join(tmpdir(), 'na0068-retention-'))
  })
  afterAll(async () => {
    if (db) {
      const scoped = { in: tenantIds }
      await db.sharedSession.deleteMany({ where: { tenantId: scoped } })
      await db.session.deleteMany({ where: { host: { tenantId: scoped } } })
      await db.authLog.deleteMany({ where: { user: { tenantId: scoped } } })
      await db.adminLog.deleteMany({ where: { admin: { tenantId: scoped } } })
      await db.trialRegistration.deleteMany({ where: { tenantId: scoped } })
      await db.inventoryNode.updateMany({ where: { tenantId: scoped }, data: { parentId: null } })
      await db.inventoryNode.deleteMany({ where: { tenantId: scoped } })
      await db.host.deleteMany({ where: { tenantId: scoped } })
      await db.user.deleteMany({ where: { tenantId: scoped } })
      await db.tenant.deleteMany({ where: { id: scoped } })
      await db.$disconnect()
    }
    if (root) await rm(root, { recursive: true, force: true })
  })
  async function graph(label: string, trialStatus?: string, retentionDays = 2) {
    const suffix = randomUUID()
    const tenant = await db.tenant.create({ data: { name: `Fixture ${label}`, slug: `retention-${suffix}` } })
    tenantIds.push(tenant.id)
    const user = await db.user.create({ data: { tenantId: tenant.id, name: `Name ${label}`, email: `${suffix}@example.com`, passwordHash: 'fixture-hash', mfaSecret: 'fixture-mfa', preferencesJson: { privateNote: 'personal fixture text' } } })
    const host = await db.host.create({ data: { tenantId: tenant.id, ownerId: user.id, name: `Host ${label}`, description: 'fixture description', ip: '10.64.0.10', sshUser: 'demo', authType: 'PASSWORD', scope: 'GLOBAL', passwordEncrypted: 'fixture-cipher' } })
    const node = await db.inventoryNode.create({ data: { tenantId: tenant.id, type: 'HOST', hostId: host.id, name: host.name, path: '/', depth: 0 } })
    const session = await db.session.create({ data: { userId: user.id, hostId: host.id, active: false, endedAt: old } })
    const execution = await db.snippetExecutionEvent.create({ data: { tenantId: tenant.id, userId: user.id, hostId: host.id, sessionId: session.id, executionId: randomUUID(), metadataJson: { snippetName: 'private fixture execution name' } } })
    const directory = path.join(root, String(session.id))
    await mkdir(directory)
    const chunkFile = path.join(directory, 'chunk-000001.jsonl.gz')
    await writeFile(chunkFile, 'private audit content')
    const audit = await db.sessionAudit.create({ data: { tenantId: tenant.id, sessionId: session.id, userId: user.id, userNameSnapshot: user.name,
      userEmailSnapshot: user.email, hostId: host.id, hostNameSnapshot: host.name, hostIpSnapshot: host.ip, connectionMethod: 'direct', startedAt: old, endedAt: old } })
    const chunk = await db.sessionAuditChunk.create({ data: { sessionAuditId: audit.id, seq: 1, startedAt: old, endedAt: old, storageKey: chunkFile } })
    const share = await db.sharedSession.create({ data: { tenantId: tenant.id, hostId: host.id, ownerUserId: user.id, sessionId: session.id,
      joinTokenHash: randomUUID(), expiresAt: old } })
    await db.sharedSessionParticipant.create({ data: { sharedSessionId: share.id, userId: user.id, role: 'OWNER' } })
    await db.sharedSessionControlLease.create({ data: { sharedSessionId: share.id, controllerUserId: user.id, grantedByUserId: user.id, expiresAt: old } })
    await db.authLog.create({ data: { userId: user.id, eventType: 'LOGIN', success: true, ip: '192.0.2.2', userAgent: 'fixture-user-agent' } })
    await db.adminLog.create({ data: { adminId: user.id, action: 'fixture', targetType: 'fixture', targetId: user.id, details: 'personal fixture detail' } })
    const registration = trialStatus ? await db.trialRegistration.create({ data: { id: randomUUID(), tenantId: tenant.id, name: user.name, email: user.email,
      phoneEncrypted: JSON.stringify(encrypt('+12025550123')), status: trialStatus, closedAt: old, expiresAt: old, profileJson: { retentionDays }, privacyVersion: 'fixture', managementHash: randomUUID().replaceAll('-', '').repeat(2), marketingConsent: true } }) : null
    if (registration) {
      await db.trialNotification.create({ data: { id: `${registration.id}:ready`, trialId: registration.id, kind: 'ready', status: 'SENT', sentAt: old } })
      const participant = await db.trialParticipant.create({ data: { id: randomUUID(), trialId: registration.id, name: 'Fixture guest', email: `${suffix}-guest@example.com`, verificationExpiresAt: old } })
      await db.trialConsentEvent.create({ data: { id: randomUUID(), trialId: registration.id, participantId: participant.id, kind: 'INVITATION_ACCEPTED', marketing: true, research: true, privacyVersion: 'fixture' } })
    }
    return { tenant, user, host, node, session, execution, audit, chunk, share, registration, directory, chunkFile }
  }
  it('purges only overdue removed trials, cascades evidence, preserves normal data and keeps a classification tombstone', async () => {
    const normal = await graph('normal')
    const removed = await graph('removed', 'REMOVED')
    const active = await graph('active', 'ACTIVE')
    const retained = await graph('retained', 'REMOVED', 30)
    expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
    expect(await db.session.findUnique({ where: { id: removed.session.id } })).toBeNull()
    expect(await db.snippetExecutionEvent.findUnique({ where: { id: removed.execution.id } })).toBeNull()
    expect((await db.inventoryNode.findUniqueOrThrow({ where: { id: removed.node.id } })).name).toBe('Recurso removido')
    expect(await db.sessionAudit.findUnique({ where: { id: removed.audit.id } })).toBeNull()
    expect(await db.sessionAuditChunk.findUnique({ where: { id: removed.chunk.id } })).toBeNull()
    expect(await db.sharedSession.findUnique({ where: { id: removed.share.id } })).toBeNull()
    expect(await db.sharedSessionParticipant.count({ where: { sharedSessionId: removed.share.id } })).toBe(0)
    expect(await db.sharedSessionControlLease.count({ where: { sharedSessionId: removed.share.id } })).toBe(0)
    expect(await db.authLog.count({ where: { userId: removed.user.id } })).toBe(0)
    expect(await db.adminLog.count({ where: { adminId: removed.user.id } })).toBe(0)
    expect(await db.trialParticipant.count({ where: { trialId: removed.registration!.id } })).toBe(0)
    expect(await db.trialNotification.count({ where: { trialId: removed.registration!.id } })).toBe(0)
    expect(await db.trialConsentEvent.count({ where: { trialId: removed.registration!.id } })).toBe(0)
    expect(await db.trialRegistration.findUnique({ where: { id: removed.registration!.id } })).toMatchObject({ tenantId: removed.tenant.id, status: 'REMOVED', email: null, phoneEncrypted: null, name: 'Removido', managementHash: null, marketingConsent: false })
    const sanitized = await db.user.findUniqueOrThrow({ where: { id: removed.user.id } })
    expect((await db.trialRegistration.findUniqueOrThrow({ where: { id: active.registration!.id } })).phoneEncrypted).toBe(active.registration!.phoneEncrypted)
    expect(sanitized).toMatchObject({ name: 'Participante removido', email: `removed-${removed.user.id}@invalid.local`, active: false, passwordHash: null, mfaSecret: null })
    expect(JSON.stringify(sanitized)).not.toContain('personal fixture text')
    await expect(access(removed.directory)).rejects.toThrow()
    for (const kept of [normal, active, retained]) {
      expect(await db.snippetExecutionEvent.findUnique({ where: { id: kept.execution.id } })).toMatchObject({ metadataJson: { snippetName: 'private fixture execution name' }, sessionId: kept.session.id })
      expect((await db.inventoryNode.findUniqueOrThrow({ where: { id: kept.node.id } })).name).toBe(kept.host.name)
      expect(await db.user.findUnique({ where: { id: kept.user.id } })).toMatchObject({ email: kept.user.email, passwordHash: 'fixture-hash', active: true })
      expect(await db.sessionAudit.findUnique({ where: { id: kept.audit.id } })).not.toBeNull()
      expect(await readFile(kept.chunkFile, 'utf8')).toBe('private audit content')
      if (kept.registration) expect(await db.trialNotification.count({ where: { trialId: kept.registration.id } })).toBe(1)
    }
    expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(0)
  })
  it('ignores a malicious stored audit path pointing into another tenant', async () => {
    const normal = await graph('path-normal')
    const removed = await graph('path-removed', 'REMOVED')
    await db.sessionAuditChunk.update({ where: { id: removed.chunk.id }, data: { storageKey: normal.chunkFile } })
    expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
    expect(await readFile(normal.chunkFile, 'utf8')).toBe('private audit content')
    await expect(access(removed.directory)).rejects.toThrow()
  })
  it('does not follow a trial session directory symlink into normal audit data', async () => {
    const normal = await graph('symlink-normal')
    const removed = await graph('symlink-removed', 'REMOVED')
    await rm(removed.directory, { recursive: true })
    await symlink(normal.directory, removed.directory)
    expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
    expect(await readFile(normal.chunkFile, 'utf8')).toBe('private audit content')
    expect(await db.session.findUnique({ where: { id: normal.session.id } })).not.toBeNull()
  })
  it('keeps database data retryable when filesystem cleanup fails', async () => {
    const removed = await graph('filesystem-failure', 'REMOVED')
    const notADirectory = path.join(root, 'not-a-directory')
    await writeFile(notADirectory, 'fixture')
    expect(await purgeExpiredTrialData(db, notADirectory, now, path.join(root, 'avatars'))).toBe(0)
    expect(await db.trialRegistration.findUnique({ where: { id: removed.registration!.id } })).toMatchObject({ email: removed.user.email, status: 'REMOVED', lastError: 'RETENTION_RETRY' })
    expect(await db.session.findUnique({ where: { id: removed.session.id } })).not.toBeNull()
    expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
  })
  it('does not let fifty not-yet-due registrations starve an overdue registration', async () => {
    const ids = Array.from({ length: 51 }, () => randomUUID())
    await db.trialRegistration.createMany({ data: ids.map((id, index) => ({
      id, name: 'Retention fixture', email: `${id}@example.com`, status: 'REMOVED', closedAt: old,
      profileJson: { retentionDays: index === 50 ? 2 : 365 }, privacyVersion: 'fixture',
    })) })
    try {
      expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
      expect(await db.trialRegistration.findUnique({ where: { id: ids[50]! } })).toMatchObject({ email: null })
      expect(await db.trialRegistration.count({ where: { id: { in: ids.slice(0, 50) }, email: { not: null } } })).toBe(50)
    } finally { await db.trialRegistration.deleteMany({ where: { id: { in: ids } } }) }
  })
  it('continues purging other due trials after an invalid session identifier requires retry', async () => {
    const failed = await graph('invalid-session', 'REMOVED')
    const ready = await graph('valid-after-failure', 'REMOVED')
    await db.session.update({ where: { id: failed.session.id }, data: { id: -1 } })
    try {
      expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
      expect(await db.trialRegistration.findUnique({ where: { id: failed.registration!.id } })).toMatchObject({ email: failed.user.email, lastError: 'RETENTION_RETRY' })
      expect(await db.trialRegistration.findUnique({ where: { id: ready.registration!.id } })).toMatchObject({ email: null })
      expect(await readFile(failed.chunkFile, 'utf8')).toBe('private audit content')
    } finally {
      await db.session.update({ where: { id: -1 }, data: { id: failed.session.id } })
      await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))
    }
  })
  it('purges full tenant credentials, callbacks, command stores, hierarchy and avatars while preserving a normal tenant', async () => {
    const normal = await graph('normal-full')
    const removed = await graph('removed-full', 'REMOVED')
    async function populate(row: Awaited<ReturnType<typeof graph>>) {
      const tenantId = row.tenant.id, userId = row.user.id, hostId = row.host.id
      const group = await db.group.create({ data: { tenantId, name: 'Private group' } })
      const folder = await db.folder.create({ data: { tenantId, userId, name: 'Private folder' } })
      const childFolder = await db.folder.create({ data: { tenantId, userId, name: 'Private child', parentId: folder.id, parentKey: folder.id } })
      await db.userGroup.create({ data: { userId, groupId: group.id } })
      const secret = await db.secret.create({ data: { tenantId, alias: 'private-contact', encryptedValue: 'fixture-secret', iv: 'fixture-iv', ownerUserId: userId, createdByUserId: userId, groupId: group.id } })
      const pem = await db.pemKey.create({ data: { createdById: userId, name: 'Private key', encryptedKey: 'fixture-key', iv: 'fixture-iv', encryptedPassphrase: 'fixture-passphrase', passphraseIv: 'fixture-iv' } })
      const snippetGroup = await db.snippetGroup.create({ data: { tenantId, createdById: userId, name: 'Private commands' } })
      const snippet = await db.snippet.create({ data: { tenantId, createdById: userId, groupId: snippetGroup.id, name: 'Private macro', command: 'private command fixture' } })
      await db.host.update({ where: { id: hostId }, data: { folderId: childFolder.id, groupId: group.id, passwordSecretId: secret.id, pemKeyId: pem.id, onePasswordRef: 'private-vault-reference', startupSnippetId: snippet.id } })
      await db.integration.create({ data: { tenantId, provider: 'fixture', config: 'private-integration-credential' } })
      await db.emailConfig.create({ data: { tenantId, provider: 'smtp', user: 'fixture@example.test', passwordEnc: 'private-smtp', passwordIv: 'fixture-iv', fromName: 'Private sender' } })
      await db.agent.create({ data: { tenantId, createdById: userId, name: 'Private agent', tokenHash: randomUUID() } })
      await db.mcpToken.create({ data: { tenantId, createdById: userId, name: 'Private MCP', tokenHash: randomUUID() } })
      await db.portForwarding.create({ data: { hostId, description: 'Private tunnel', localPort: 22000, remoteHost: 'fixture.example.test', remotePort: 22 } })
      await db.webhookSubscription.create({ data: { tenantId, createdByUserId: userId, name: 'Private callback', targetUrl: 'https://fixture.example.test', subscribedEventsJson: '[]', secretEncrypted: 'private-webhook', secretIv: 'fixture-iv' } })
      await db.webhookEventOutbox.create({ data: { tenantId, eventType: 'fixture', resourceType: 'host', resourceId: String(hostId), eventPayloadJson: '{"private":"fixture"}', occurredAt: old } })
      await db.inboundWebhookEndpoint.create({ data: { tenantId, provider: 'fixture', name: 'Private ingress', endpointTokenHash: randomUUID(), allowedEventTypesJson: '[]', createdByUserId: userId } })
      await db.hostImportJob.create({ data: { tenantId, actorId: userId, previewId: randomUUID(), source: 'fixture' } })
      const diagnostic = await db.diagnosticRun.create({ data: { tenantId, hostId, playbookId: 1, requestedById: userId } })
      const diagnosticCommand = await db.diagnosticRunCommand.create({ data: { runId: diagnostic.id, commandId: 'fixture', command: 'private command', outputBody: 'private output' } })
      const action = await db.aiSshActionRun.create({ data: { tenantId, hostId, requestedById: userId, channel: 'fixture', summary: 'private action', mode: 'READ_ONLY' } })
      const actionStep = await db.aiSshActionRunStep.create({ data: { runId: action.id, stepId: 'fixture', label: 'Private step', command: 'private command' } })
      const jira = await db.jiraInteraction.create({ data: { id: randomUUID(), tenantId, userId, hostId } })
      const jiraSession = await db.jiraInteractionSession.create({ data: { interactionId: jira.id, sessionId: row.session.id } })
      await db.networkTacacsCredential.create({ data: { tenantId, userId, username: `fixture-${userId}`, passwordHash: 'private-tacacs-hash' } })
      await db.networkTacacsEvent.create({ data: { tenantId, deviceId: hostId, username: `fixture-${userId}`, kind: 'fixture', outcome: 'fixture', commandJson: 'private event' } })
      const avatarDir = path.join(root, 'avatars', createHash('sha256').update(String(tenantId)).digest('hex').slice(0, 16))
      await mkdir(avatarDir, { recursive: true }); const avatar = path.join(avatarDir, `${userId}.avatar`); await writeFile(avatar, 'private avatar')
      await db.user.update({ where: { id: userId }, data: { avatarMimeType: 'image/png', avatarUpdatedAt: old } })
      return { pem, diagnosticCommand, actionStep, jiraSession, avatar }
    }
    try {
      const kept = await populate(normal), purged = await populate(removed)
      expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
      for (const tenantId of [removed.tenant.id, normal.tenant.id]) {
        const count = tenantId === removed.tenant.id ? 0 : 1
        expect(await db.secret.count({ where: { tenantId } })).toBe(count)
        expect(await db.integration.count({ where: { tenantId } })).toBe(count)
        expect(await db.emailConfig.count({ where: { tenantId } })).toBe(count)
        expect(await db.snippet.count({ where: { tenantId } })).toBe(count)
        expect(await db.snippetGroup.count({ where: { tenantId } })).toBe(count)
        expect(await db.agent.count({ where: { tenantId } })).toBe(count)
        expect(await db.mcpToken.count({ where: { tenantId } })).toBe(count)
        expect(await db.webhookSubscription.count({ where: { tenantId } })).toBe(count)
        expect(await db.webhookEventOutbox.count({ where: { tenantId } })).toBe(count)
        expect(await db.inboundWebhookEndpoint.count({ where: { tenantId } })).toBe(count)
        expect(await db.hostImportJob.count({ where: { tenantId } })).toBe(count)
        expect(await db.group.count({ where: { tenantId } })).toBe(count)
        expect(await db.folder.count({ where: { tenantId } })).toBe(count * 2)
        expect(await db.networkTacacsCredential.count({ where: { tenantId } })).toBe(count)
        expect(await db.networkTacacsEvent.count({ where: { tenantId } })).toBe(count)
      }
      expect(await db.diagnosticRunCommand.findUnique({ where: { id: purged.diagnosticCommand.id } })).toBeNull()
      expect(await db.aiSshActionRunStep.findUnique({ where: { id: purged.actionStep.id } })).toBeNull()
      expect(await db.jiraInteractionSession.findUnique({ where: { id: purged.jiraSession.id } })).toBeNull()
      expect(await db.pemKey.findUnique({ where: { id: purged.pem.id } })).toBeNull()
      expect(await db.pemKey.findUnique({ where: { id: kept.pem.id } })).toMatchObject({ encryptedKey: 'fixture-key', encryptedPassphrase: 'fixture-passphrase' })
      expect(await db.user.findUnique({ where: { id: removed.user.id } })).toMatchObject({ avatarMimeType: null, avatarUpdatedAt: null })
      expect(await db.host.findUnique({ where: { id: removed.host.id } })).toMatchObject({ onePasswordRef: null, pemKeyId: null, passwordSecretId: null, startupSnippetId: null })
      await expect(access(purged.avatar)).rejects.toThrow()
      expect(await readFile(kept.avatar, 'utf8')).toBe('private avatar')
    } finally {
      // Cleanup only this synthetic normal fixture after preservation assertions.
      await db.trialRegistration.create({ data: { id: randomUUID(), tenantId: normal.tenant.id, name: 'Cleanup fixture', email: normal.user.email, status: 'REMOVED', closedAt: old, profileJson: { retentionDays: 2 }, privacyVersion: 'fixture' } })
      await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))
    }
  })
  it('refuses shared cross-tenant PEM references and preserves the normal credential until a safe retry', async () => {
    const normal = await graph('cross-key-normal')
    const removed = await graph('cross-key-removed', 'REMOVED')
    const key = await db.pemKey.create({ data: { createdById: removed.user.id, name: 'Fixture shared key', encryptedKey: 'fixture-cross-key', iv: 'fixture-iv' } })
    await db.host.update({ where: { id: normal.host.id }, data: { pemKeyId: key.id } })
    try {
      expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(0)
      expect(await db.pemKey.findUnique({ where: { id: key.id } })).toMatchObject({ encryptedKey: 'fixture-cross-key' })
      expect(await db.host.findUnique({ where: { id: normal.host.id } })).toMatchObject({ pemKeyId: key.id, passwordEncrypted: 'fixture-cipher' })
      expect(await db.trialRegistration.findUnique({ where: { id: removed.registration!.id } })).toMatchObject({ email: removed.user.email, lastError: 'RETENTION_RETRY' })
    } finally {
      await db.host.update({ where: { id: normal.host.id }, data: { pemKeyId: null } })
      expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
    }
  })
  it('unlinks a trial avatar directory symlink without following it into normal avatar files', async () => {
    const normal = await graph('avatar-normal')
    const removed = await graph('avatar-removed', 'REMOVED')
    const directory = (id: number): string => path.join(root, 'avatars', createHash('sha256').update(String(id)).digest('hex').slice(0, 16))
    await mkdir(directory(normal.tenant.id), { recursive: true })
    const normalAvatar = path.join(directory(normal.tenant.id), `${normal.user.id}.avatar`)
    await writeFile(normalAvatar, 'normal avatar fixture')
    await symlink(directory(normal.tenant.id), directory(removed.tenant.id))
    expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
    expect(await readFile(normalAvatar, 'utf8')).toBe('normal avatar fixture')
    await expect(access(directory(removed.tenant.id))).rejects.toThrow()
  })
  it('rechecks the retention deadline under the row lock before removing files selected by an earlier snapshot', async () => {
    const removed = await graph('deadline-race', 'REMOVED')
    let locked!: () => void, selected!: () => void
    const lockedPromise = new Promise<void>(resolve => { locked = resolve })
    const selectedPromise = new Promise<void>(resolve => { selected = resolve })
    const observer = db.$extends({ query: { trialRegistration: { async findMany({ args, query }) {
      const result = await query(args); selected(); return result
    } } } })
    const change = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${removed.registration!.id} FOR UPDATE`
      await tx.trialRegistration.update({ where: { id: removed.registration!.id }, data: { profileJson: { retentionDays: 365 } } })
      locked(); await selectedPromise
    })
    await lockedPromise
    try {
      const result = purgeExpiredTrialData(observer as unknown as PrismaClient, root, now, path.join(root, 'avatars'))
      await change
      expect(await result).toBe(0)
      expect(await readFile(removed.chunkFile, 'utf8')).toBe('private audit content')
      expect(await db.user.findUnique({ where: { id: removed.user.id } })).toMatchObject({ email: removed.user.email, passwordHash: 'fixture-hash' })
    } finally {
      await db.trialRegistration.update({ where: { id: removed.registration!.id }, data: { profileJson: { retentionDays: 2 } } })
      await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))
    }
  })
  it('retains no lab lifecycle action for unverified registrations without tenants', async () => {
    const registration = await db.trialRegistration.create({ data: { id: randomUUID(), name: 'Unverified fixture', phoneEncrypted: JSON.stringify(encrypt('+12025550124')), email: `${randomUUID()}@example.com`, status: 'REMOVED', closedAt: old, profileJson: { retentionDays: 2 }, privacyVersion: 'fixture' } })
    try {
      expect(await purgeExpiredTrialData(db, root, now, path.join(root, 'avatars'))).toBe(1)
      expect(await db.trialRegistration.findUnique({ where: { id: registration.id } })).toMatchObject({ email: null, phoneEncrypted: null, name: 'Removido', tenantId: null })
    } finally { await db.trialRegistration.delete({ where: { id: registration.id } }) }
  })
})
