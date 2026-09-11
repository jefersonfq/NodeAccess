import { it, expect } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID, createHash } from 'node:crypto'
import { SharedSessionRepository } from './shared-session.repository.js'

// Opt-in: isolated records on a developer MySQL database. Never connects to SSH.
it.skipIf(process.env.RUN_SHARE_MYSQL !== 'true')('serializes concurrent creation across repository instances in MySQL', async () => {
 const db = new PrismaClient()
 let hostId: number | undefined, sessionId: number | undefined
 try {
  const user = await db.user.findFirstOrThrow({ where: { active: true, deletedAt: null }, select: { id: true, tenantId: true } })
  const host = await db.host.create({ data: { name: `share-concurrency-test-${randomUUID()}`, ip: '192.0.2.1', sshUser: 'test', authType: 'PASSWORD', scope: 'PERSONAL', ownerId: user.id, tenantId: user.tenantId } }); hostId = host.id
  const session = await db.session.create({ data: { userId: user.id, hostId: host.id } }); sessionId = session.id
  const results = await Promise.all(Array.from({ length: 8 }, () => new SharedSessionRepository(db).create({ tenantId: user.tenantId, hostId: host.id, ownerUserId: user.id, sessionId: session.id, joinTokenHash: createHash('sha256').update(randomUUID()).digest('hex'), tokenEncrypted: 'test-only', tokenIv: 'test-only', expiresAt: new Date(Date.now() + 60000) })))
  expect(new Set(results.map(r => r.id)).size).toBe(1)
  expect(await db.sharedSession.count({ where: { sessionId: session.id } })).toBe(1)
  expect(await db.sharedSessionParticipant.count({ where: { sharedSessionId: results[0]!.id } })).toBe(1)
 } finally {
  if (sessionId) { await db.sharedSession.deleteMany({ where: { sessionId } }); await db.session.delete({ where: { id: sessionId } }) }
  if (hostId) await db.host.delete({ where: { id: hostId } })
  await db.$disconnect()
 }
}, 20000)
