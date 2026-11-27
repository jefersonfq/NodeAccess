import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { siteCurrentHosts, siteHostAccess, siteHostChoices } from './vault-sites-hosts.js'

const identity = { tenantId: 7, userId: 2, sessionVersion: 1 }
function fixture() {
  const hosts = [{ id: 1, name: 'Hidden' }, { id: 2, name: 'Visible' }]
  const db = { host: { findFirst: vi.fn(() => Promise.resolve(hosts[1])), findMany: vi.fn(() => Promise.resolve(hosts)) },
    hostAssociatedLink: { findMany: vi.fn((_args: unknown) => Promise.resolve([{ urlTemplate: 'https://{{HOST.IP}}/admin', host: { ...hosts[1]!, ip: 'example.test', port: 22, sshUser: 'hidden-user' } }])) },
    $queryRaw: vi.fn(() => Promise.resolve([{ hostId: 1, canView: 0 }, { hostId: 2, canView: 1 }])) }
  return { db, tx: db as unknown as Prisma.TransactionClient, hosts }
}
describe('sites reuse host permissions and registered links', () => {
  it('uses tenant/deleted guard and denies invisible or missing host IDs', async () => {
    const f = fixture(), read = siteHostAccess('USER')
    expect(await read(f.tx, identity, 2)).toEqual(f.hosts[1])
    expect(f.db.host.findFirst).toHaveBeenCalledWith({ where: { id: 2, tenantId: 7, deletedAt: null }, select: { id: true, name: true } })
    f.db.$queryRaw.mockResolvedValue([]); expect(await read(f.tx, identity, 2)).toBeNull()
    f.db.host.findFirst.mockResolvedValue(null as never); expect(await siteHostAccess('ADMIN')(f.tx, identity, 2)).toBeNull()
  })
  it('filters before limiting choices and returns no hidden total', async () => {
    const f = fixture()
    expect(await siteHostChoices(f.tx, identity, 'USER', 'Visible')).toEqual([f.hosts[1]])
    expect(await siteHostChoices(f.tx, identity, 'ADMIN', '')).toEqual(f.hosts)
    expect(await siteHostAccess('ADMIN')(f.tx, identity, 2)).toEqual(f.hosts[1])
  })
  it('recognizes an existing HTTPS associated link without exposing template or SSH metadata', async () => {
    const f = fixture()
    expect(await siteCurrentHosts(f.tx, identity, 'USER', 'https://example.test')).toEqual([{ id: 2, name: 'Visible' }])
    expect(f.db.hostAssociatedLink.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { tenantId: 7, enabled: true, sourceStatus: { in: ['MANUAL', 'SYNCED'] } } })
    f.db.$queryRaw.mockResolvedValue([]); expect(await siteCurrentHosts(f.tx, identity, 'USER', 'https://example.test')).toEqual([])
  })
  it.each(['https://example.test.evil', 'https://sub.example.test', 'https://example.test:444'])('does not match a different exact origin %s', async origin => {
    const f = fixture(); expect(await siteCurrentHosts(f.tx, identity, 'ADMIN', origin)).toEqual([])
  })
  it.each(['http://example.test', 'https://user:password@example.test', 'not-a-url'])('ignores unsafe or invalid registered links %s', async template => {
    const f = fixture(); f.db.hostAssociatedLink.findMany.mockResolvedValue([{ urlTemplate: template, host: { ...f.hosts[1]!, ip: 'example.test', port: 22, sshUser: 'synthetic' } }])
    expect(await siteCurrentHosts(f.tx, identity, 'ADMIN', 'https://example.test')).toEqual([])
  })
})
