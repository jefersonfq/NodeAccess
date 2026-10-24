import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { SnippetExecutionEventService } from './snippet-execution-event.service.js'

const connection = process.env.SNIPPET_INTEGRATION_DATABASE_URL
const real = connection ? describe : describe.skip
real('macro execution metadata on isolated MySQL', () => {
  let db: PrismaClient
  let tenantId: number
  let ownerId: number
  let otherId: number
  let snippetId: number
  beforeAll(async () => {
    const url = new URL(connection!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/na0068_retention') throw new Error('Only the isolated local integration schema is accepted')
    db = new PrismaClient({ datasourceUrl: connection! }); await db.$connect()
    const id = randomUUID()
    tenantId = (await db.tenant.create({ data: { name: 'Macro integration fixture', slug: `macro-${id}` } })).id
    ownerId = (await db.user.create({ data: { tenantId, name: 'Owner', email: `owner-${id}@example.com` } })).id
    otherId = (await db.user.create({ data: { tenantId, name: 'Other', email: `other-${id}@example.com` } })).id
    snippetId = (await db.snippet.create({ data: { tenantId, createdById: ownerId, name: 'Shared macro', scope: 'TEAM', command: 'pwd' } })).id
  })
  afterAll(async () => {
    if (!db) return
    if (tenantId) {
      await db.snippetExecutionEvent.deleteMany({ where: { tenantId } })
      await db.snippet.deleteMany({ where: { tenantId } })
      await db.user.deleteMany({ where: { tenantId } })
      await db.tenant.delete({ where: { id: tenantId } })
    }
    await db.$disconnect()
  })
  it('preserves macro progress while merging repeated transport metadata', async () => {
    const events = new SnippetExecutionEventService(db), executionId = randomUUID()
    const input = { tenantId, userId: ownerId, snippetId, executionId, source: 'TERMINAL' as const, status: 'SENT' as const }
    await events.record({ ...input, metadata: { macro: { status: 'completed', step: 2, total: 2 }, first: true } })
    await events.record({ ...input, metadata: { correlationId: 'fixture' } })
    const stored = await db.snippetExecutionEvent.findUniqueOrThrow({ where: { tenantId_executionId: { tenantId, executionId } } })
    expect(stored.metadataJson).toEqual({ macro: { status: 'completed', step: 2, total: 2 }, first: true, correlationId: 'fixture' })
    expect(await db.snippetExecutionEvent.count({ where: { tenantId, executionId } })).toBe(1)
  })
  it('does not let another user overwrite an event through an execution ID collision', async () => {
    const events = new SnippetExecutionEventService(db), executionId = randomUUID()
    await events.record({ tenantId, userId: ownerId, snippetId, executionId, source: 'TERMINAL', status: 'SENT', metadata: { macro: { status: 'completed', step: 2, total: 2 } } })
    const original = await db.snippetExecutionEvent.findUniqueOrThrow({ where: { tenantId_executionId: { tenantId, executionId } } })
    await events.record({ tenantId, userId: otherId, snippetId, executionId, source: 'MCP', status: 'FAILED_SECRET_RESOLUTION', metadata: { macro: { status: 'failed', step: 0, total: 2 } } })
    expect(await db.snippetExecutionEvent.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original)
  })
  it('preserves the original event when the same user reuses its execution ID for another snippet', async () => {
    const otherSnippet = await db.snippet.create({ data: { tenantId, createdById: ownerId, name: 'Other macro', scope: 'TEAM', command: 'whoami' } })
    const host = await db.host.create({ data: { tenantId, ownerId, name: 'Collision fixture', ip: '192.0.2.10', sshUser: 'fixture', authType: 'PASSWORD', scope: 'PERSONAL' } })
    const session = await db.session.create({ data: { userId: ownerId, hostId: host.id, active: false } })
    try {
      const events = new SnippetExecutionEventService(db), executionId = randomUUID()
      await events.record({ tenantId, userId: ownerId, snippetId, executionId, source: 'TERMINAL', status: 'SENT', metadata: { macro: { status: 'completed', step: 2, total: 2 } } })
      const original = await db.snippetExecutionEvent.findUniqueOrThrow({ where: { tenantId_executionId: { tenantId, executionId } } })
      await events.record({ tenantId, userId: ownerId, snippetId: otherSnippet.id, executionId, source: 'MCP', status: 'FAILED_SECRET_RESOLUTION', hostId: host.id, sessionId: session.id, metadata: { macro: { status: 'failed', step: 0, total: 2 } } })
      expect(await db.snippetExecutionEvent.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original)
    } finally {
      await db.session.delete({ where: { id: session.id } })
      await db.host.delete({ where: { id: host.id } })
    }
  })

})
