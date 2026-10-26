import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionAuditAiRepository } from './session-audit-ai.repository.js'

const connection = process.env.TRIAL_AI_QUEUE_DATABASE_URL
const real = connection ? describe : describe.skip
real('full trial AI queue isolation against MySQL', () => {
  let db: PrismaClient
  const tenants: number[] = []
  beforeAll(async () => {
    const url = new URL(connection!)
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/nodeaccess_test_na0074') throw new Error('Disposable local NA0074 schema required')
    db = new PrismaClient({ datasourceUrl: connection! })
    await db.$connect()
  })
  afterAll(async () => {
    if (!db) return
    const scope = { in: tenants }
    await db.sessionAudit.deleteMany({ where: { tenantId: scope } })
    await db.session.deleteMany({ where: { host: { tenantId: scope } } })
    await db.trialRegistration.deleteMany({ where: { tenantId: scope } })
    await db.host.deleteMany({ where: { tenantId: scope } })
    await db.user.deleteMany({ where: { tenantId: scope } })
    await db.tenant.deleteMany({ where: { id: scope } })
    await db.$disconnect()
  })
  async function fixture(experience?: 'full' | 'guided'): Promise<{ tenantId: number; auditId: number }> {
    const id = randomUUID()
    const tenant = await db.tenant.create({ data: { name: 'AI queue fixture', slug: `ai-queue-${id}` } })
    tenants.push(tenant.id)
    const user = await db.user.create({ data: { tenantId: tenant.id, name: 'Queue Fixture', email: `${id}@example.invalid`, passwordHash: 'non-authenticating-fixture' } })
    const host = await db.host.create({ data: { tenantId: tenant.id, ownerId: user.id, name: 'Queue fixture', ip: '192.0.2.10', port: 22, sshUser: 'fixture', authType: 'PASSWORD', scope: 'PERSONAL' } })
    const session = await db.session.create({ data: { userId: user.id, hostId: host.id, active: false } })
    const audit = await db.sessionAudit.create({ data: { tenantId: tenant.id, sessionId: session.id, userId: user.id, userNameSnapshot: user.name, userEmailSnapshot: user.email, hostId: host.id, hostNameSnapshot: host.name, hostIpSnapshot: host.ip, connectionMethod: 'direct', startedAt: new Date() } })
    if (experience) await db.trialRegistration.create({ data: { id, tenantId: tenant.id, name: user.name, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000), profileJson: { experience }, privacyVersion: 'fixture' } })
    return { tenantId: tenant.id, auditId: audit.id }
  }
  it('filters before LIMIT and only requeues full-trial stale rows while global feature is off', async () => {
    const normal = await fixture()
    const guided = await fixture('guided')
    const full = await fixture('full')
    const pending = async (f: typeof full, date: string): Promise<number> => (await db.sessionAuditAiJob.create({ data: { tenantId: f.tenantId, sessionAuditId: f.auditId, kind: 'SUMMARY', triggerSource: 'MANUAL', provider: 'openai', createdAt: new Date(date) } })).id
    const normalJob = await pending(normal, '1901-01-01T00:00:00Z')
    await pending(guided, '1901-01-02T00:00:00Z')
    const fullJob = await pending(full, '1902-01-01T00:00:00Z')
    const repo = new SessionAuditAiRepository(db)
    expect((await repo.listPendingSummaryJobs(1, true)).map(j => j.id)).toEqual([fullJob])
    expect((await repo.listPendingSummaryJobs(1)).map(j => j.id)).toEqual([normalJob])
    const ownJobs = await db.sessionAuditAiJob.findMany({ where: { tenantId: { in: tenants } }, select: { id: true } })
    await db.sessionAuditAiJob.updateMany({ where: { id: { in: ownJobs.map(j => j.id) } }, data: { status: 'PROCESSING', startedAt: new Date('1903-01-01T00:00:00Z') } })
    expect(await repo.requeueStaleProcessingJobs(new Date('1905-01-01T00:00:00Z'), true)).toBe(1)
    expect((await db.sessionAuditAiJob.findUniqueOrThrow({ where: { id: fullJob } })).status).toBe('PENDING')
    expect(await db.sessionAuditAiJob.count({ where: { tenantId: { in: [normal.tenantId, guided.tenantId] }, status: 'PROCESSING' } })).toBe(2)
    expect(await repo.requeueStaleProcessingJobs(new Date('1905-01-01T00:00:00Z'))).toBe(2)
  })
})
