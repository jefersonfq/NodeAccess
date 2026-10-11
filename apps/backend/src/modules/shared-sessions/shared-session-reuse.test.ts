import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { SharedSessionService } from './shared-session.service.js'
import { SharedSessionRepository } from './shared-session.repository.js'
vi.mock('../../shared/crypto.js', () => ({ encrypt: (s: string) => ({ encrypted: s, iv: 'iv' }), decrypt: ({ encrypted }: { encrypted: string }) => encrypted }))
const row = { id: 21, tenantId: 2, hostId: 5, hostName: 'Proxy lab', sessionId: 7, ownerUserId: 9, ownerName: 'Owner', ownerEmail: null, status: 'ACTIVE', tokenEncrypted: 'existing-token', tokenIv: 'iv', joinTokenHash: createHash('sha256').update('existing-token').digest('hex'), expiresAt: new Date(Date.now() + 600000), createdAt: new Date(), updatedAt: new Date() }
function setup(existing = [row]) {
 const repo = { findByTokenHash: vi.fn().mockResolvedValue(row), findById: vi.fn().mockResolvedValue(row), upsertViewerParticipant: vi.fn().mockResolvedValue(undefined), touchParticipant: vi.fn().mockResolvedValue(undefined), findActiveSessionForShare: vi.fn().mockResolvedValue({ active: true, hostId: 5, ownerUserId: 9 }), listActiveBySessionId: vi.fn().mockResolvedValue(existing), findParticipant: vi.fn().mockResolvedValue({ userId: 10, role: "VIEWER", leftAt: null }), createControlLease: vi.fn(), findParticipants: vi.fn().mockResolvedValue([]), findActiveControlLease: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(row), revoke: vi.fn(), endActiveControlLease: vi.fn() }
 const broker = { publishControlRequested: vi.fn(), publishControlGranted: vi.fn(), registerSharedSession: vi.fn(), unregisterSharedSession: vi.fn(), getPendingControlRequestUserIds: vi.fn().mockReturnValue([10]) }
 const ssh = { hasEffectiveHostPermission: vi.fn().mockResolvedValue(true) }
 const service = new SharedSessionService(repo as never, { findById: vi.fn().mockResolvedValue({ id: 5, scope: 'GLOBAL', tags: [] }) } as never, ssh as never, { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never, { findSharedSessionSettings: vi.fn().mockResolvedValue({ expiryMinutes: [10] }) } as never, broker as never)
 return { repo, broker, ssh, service }
}
describe('live share reuse', () => {
 it('returns the same link and expiry without disconnecting viewers or replacing broker state', async () => {
  const { service, repo, broker } = setup()
  repo.findActiveControlLease.mockResolvedValue({ id: 3, sharedSessionId: 21, controllerUserId: 10, grantedByUserId: 9, startedAt: new Date(), expiresAt: row.expiresAt, endedAt: null, endReason: null, revokeReason: null })
  repo.findParticipants.mockResolvedValue([{ id: 4, sharedSessionId: 21, userId: 10, name: 'Viewer', email: null, role: 'VIEWER', joinedAt: new Date(), leftAt: null, lastSeenAt: new Date() }])
  const results = await Promise.all(Array.from({ length: 5 }, () => service.create({ sessionId: 7, expiresInMinutes: 10 }, 2, 9, 'USER')))
  expect(new Set(results.map(r => r.joinUrl)).size).toBe(1)
  expect(results[0]).toMatchObject({ id: 21, expiresAt: row.expiresAt, pendingControlRequestUserIds: [10] })
  expect(results[0]?.activeControlLease).toMatchObject({ controllerUserId: 10, expiresAt: row.expiresAt })
  expect(results[0]?.participants).toEqual([expect.objectContaining({ userId: 10, role: 'viewer', leftAt: null }) as unknown])
  expect(repo.revoke).not.toHaveBeenCalled(); expect(repo.endActiveControlLease).not.toHaveBeenCalled(); expect(repo.create).not.toHaveBeenCalled()
  expect(broker.unregisterSharedSession).not.toHaveBeenCalled(); expect(broker.registerSharedSession).not.toHaveBeenCalled()
 })
 it('reuses the winner of concurrent creation without resetting its broker', async () => {
  const { service, broker } = setup([])
  expect((await service.create({ sessionId: 7, expiresInMinutes: 10 }, 2, 9, 'USER')).joinUrl).toContain('existing-token')
  expect(broker.registerSharedSession).not.toHaveBeenCalled()
 })
 it('fails safely for a legacy share without recoverable token', async () => {
  const { service, repo } = setup([{ ...row, tokenEncrypted: null as never }])
  await expect(service.create({ sessionId: 7, expiresInMinutes: 10 }, 2, 9, 'USER')).rejects.toMatchObject({ code: 'SHARED_SESSION_LINK_UNAVAILABLE' })
  expect(repo.revoke).not.toHaveBeenCalled()
 })
 it('checks owner and current host ACL before returning a link', async () => {
  const { service, repo, ssh } = setup()
  await expect(service.create({ sessionId: 7, expiresInMinutes: 10 }, 2, 10, 'USER')).rejects.toThrow()
  ssh.hasEffectiveHostPermission.mockResolvedValue(false)
  await expect(service.create({ sessionId: 7, expiresInMinutes: 10 }, 2, 9, 'USER')).rejects.toThrow()
  expect(repo.listActiveBySessionId).not.toHaveBeenCalled()
 })
})
it('repository locks the parent before checking/inserting and returns an existing share without writes', async () => {
 const tx = { $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([{ hash: row.joinTokenHash }]), $executeRaw: vi.fn() }
 const db = { $transaction: vi.fn((f: (tx: unknown) => unknown) => f(tx)), $queryRaw: vi.fn().mockResolvedValue([row]) }
 const repo = new SharedSessionRepository(db as never)
 await expect(repo.create({ tenantId: 2, hostId: 5, ownerUserId: 9, sessionId: 7, joinTokenHash: 'new-hash', expiresAt: row.expiresAt })).resolves.toEqual(row)
 expect((tx.$queryRaw.mock.calls[0]![0] as { sql: string }).sql).toContain('FOR UPDATE')
 expect(tx.$executeRaw).not.toHaveBeenCalled()
})

it('resolving a link does not count a viewer until the WebSocket channel is joined', async () => {
 const { service, repo } = setup()
 await service.resolve('existing-token', 2, 10, 'USER')
 expect(repo.upsertViewerParticipant).not.toHaveBeenCalled()
 await service.joinChannel(21, 2, 10, 'USER')
 expect(repo.upsertViewerParticipant).toHaveBeenCalledTimes(1)
 expect(repo.upsertViewerParticipant).toHaveBeenCalledWith(21, 10)
})

it('rejects resolving an expired or foreign share without registering a participant', async () => {
 const { service, repo } = setup()
 await expect(service.resolve('existing-token', 999, 10, 'USER')).rejects.toThrow()
 repo.findByTokenHash.mockResolvedValue({ ...row, expiresAt: new Date(0) })
 await expect(service.resolve('existing-token', 2, 10, 'USER')).rejects.toMatchObject({ code: 'SHARED_SESSION_EXPIRED' })
 expect(repo.upsertViewerParticipant).not.toHaveBeenCalled()
})


describe('control failure boundaries', () => {
 it.each(['REVOKED', 'ENDED', 'EXPIRED'])('rejects request and grant after %s without notifying or writing a lease', async status => {
  const { service, repo, broker } = setup()
  repo.findById.mockResolvedValue({ ...row, status: status === 'EXPIRED' ? 'ACTIVE' : status, expiresAt: status === 'EXPIRED' ? new Date(0) : row.expiresAt })
  await expect(service.requestControl(21, {}, 2, 10, 'USER')).rejects.toMatchObject({ code: `SHARED_SESSION_${status}` })
  await expect(service.grantControl(21, 10, { leaseMinutes: 1 }, 2, 9, 'USER')).rejects.toMatchObject({ code: `SHARED_SESSION_${status}` })
  expect(repo.createControlLease).not.toHaveBeenCalled()
  expect(broker.publishControlRequested).not.toHaveBeenCalled()
  expect(broker.publishControlGranted).not.toHaveBeenCalled()
 })
 it.each(['foreign tenant', 'viewer managing', 'ACL revoked', 'participant left', 'lease occupied'])('rejects grant for %s without changing broker state', async failure => {
  const { service, repo, broker, ssh } = setup()
  if (failure === 'ACL revoked') ssh.hasEffectiveHostPermission.mockResolvedValue(false)
  if (failure === 'participant left') repo.findParticipant.mockResolvedValue({ userId: 10, role: 'VIEWER', leftAt: new Date() })
  if (failure === 'lease occupied') repo.findActiveControlLease.mockResolvedValue({ controllerUserId: 11 })
  await expect(service.grantControl(21, 10, { leaseMinutes: 1 }, failure === 'foreign tenant' ? 3 : 2, failure === 'viewer managing' ? 11 : 9, 'USER')).rejects.toThrow()
  expect(repo.createControlLease).not.toHaveBeenCalled()
  expect(broker.registerSharedSession).not.toHaveBeenCalled()
 })
 it('does not publish a successful grant when the database fails', async () => {
  const { service, repo, broker } = setup()
  repo.createControlLease.mockRejectedValue(new Error('database unavailable'))
  await expect(service.grantControl(21, 10, { leaseMinutes: 1 }, 2, 9, 'USER')).rejects.toThrow('database unavailable')
  expect(broker.publishControlGranted).not.toHaveBeenCalled()
  expect(broker.registerSharedSession).not.toHaveBeenCalled()
 })
 it('does not revive expired participation through a delayed heartbeat', async () => {
  const { service, repo } = setup()
  repo.findById.mockResolvedValue({ ...row, expiresAt: new Date(0) })
  expect(await service.touchChannelParticipant(21, 10)).toBe(false)
  expect(repo.touchParticipant).not.toHaveBeenCalled()
 })
})
