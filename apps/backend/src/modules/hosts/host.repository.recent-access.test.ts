import { describe, expect, it, vi } from 'vitest'
import { HostRepository } from './host.repository.js'

describe('HostRepository recent access', () => {
  it('groups history by the authenticated user and detects an active session', async () => {
    const startedAt = new Date('2026-09-23T14:42:00.000Z')
    const db = { session: {
      groupBy: vi.fn().mockResolvedValue([{ hostId: 10, _max: { startedAt } }]),
      findMany: vi.fn().mockResolvedValue([{ hostId: 10 }]),
    } }
    const repository = new HostRepository(db as never, {} as never)
    expect(await repository.findRecentAccessByHostIds(1, 2, [10, 11])).toEqual(new Map([[10, { hostId: 10, lastAccessedAt: startedAt, active: true }]]))
    expect(db.session.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 2, hostId: { in: [10, 11] }, host: { tenantId: 1 }, accessType: 'authenticated' } }))
  })

  it('does not query the database for an empty shortcut list', async () => {
    const db = { session: { groupBy: vi.fn(), findMany: vi.fn() } }
    const repository = new HostRepository(db as never, {} as never)
    expect(await repository.findRecentAccessByHostIds(1, 2, [])).toEqual(new Map())
    expect(db.session.groupBy).not.toHaveBeenCalled()
  })
})
