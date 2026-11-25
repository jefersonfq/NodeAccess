import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { siteHostChoices } from './vault-sites-hosts.js'

describe('host choices at synthetic inventory scale', () => {
  it('applies ACL before the 50-choice boundary and permits searching late matches', async () => {
    const identity = { tenantId: 7, userId: 2, sessionVersion: 1 }
    const hosts = Array.from({ length: 5000 }, (_, index) => ({ id: index + 1, name: `Host ${index + 1}` }))
    const db = { host: { findMany: vi.fn(() => Promise.resolve(hosts)) },
      $queryRaw: vi.fn(() => Promise.resolve(hosts.map(host => ({ hostId: host.id, canView: host.id > 4500 ? 1 : 0 })))) }
    const tx = db as unknown as Prisma.TransactionClient
    expect(await siteHostChoices(tx, identity, 'USER', '')).toEqual(hosts.slice(4500, 4550))
    expect(db.host.findMany).toHaveBeenLastCalledWith({ where: { tenantId: 7, deletedAt: null }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] })
    db.host.findMany.mockResolvedValue([hosts[4998]!])
    expect(await siteHostChoices(tx, identity, 'USER', '4999')).toEqual([hosts[4998]])
    expect(db.host.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { tenantId: 7, deletedAt: null, name: { contains: '4999' } } }))
    db.$queryRaw.mockResolvedValue([])
    expect(await siteHostChoices(tx, identity, 'USER', '4999')).toEqual([])
  })
})
