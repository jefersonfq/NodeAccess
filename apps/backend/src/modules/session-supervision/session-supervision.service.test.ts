import { it, expect, vi } from 'vitest'
import { SessionSupervisionService } from './session-supervision.service.js'
function setup(enabled: boolean, version = 1, allowed = true) {
  const db = { user: { findFirst: vi.fn().mockResolvedValue({ sessionVersion: version, role: 'USER', tenant: { active: true } }) }, $queryRaw: vi.fn().mockResolvedValue([{ enabled }]), session: { findFirst: vi.fn().mockResolvedValue({ hostId: 5 }) } }
  const ssh = { hasEffectiveHostPermission: vi.fn().mockResolvedValue(allowed) }
  return { db, ssh, service: new SessionSupervisionService(db as never, {} as never, ssh as never), user: { sub: '7', tenantId: 2, sessionVersion: 1, role: 'admin' } as never }
}
it('requires explicit supervision permission even for admin token', async () => {
  const { service, user, db } = setup(false)
  await expect(service.authorize(user, 8)).rejects.toThrow()
  expect(db.session.findFirst).not.toHaveBeenCalled()
})
it('rejects revoked identity and host ACL', async () => {
  const stale = setup(true, 2)
  await expect(stale.service.authorize(stale.user, 8)).rejects.toThrow()
  const denied = setup(true, 1, false)
  await expect(denied.service.authorize(denied.user, 8)).rejects.toThrow()
})
it('uses current role and tenant rather than stale token privileges', async () => {
  const { service, user, db, ssh } = setup(true)
  await expect(service.authorize(user, 8)).resolves.toEqual({ hostId: 5 })
  expect(db.session.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ host: expect.objectContaining({ tenantId: 2, deletedAt: null }) }) }))
  expect(ssh.hasEffectiveHostPermission).toHaveBeenCalledWith(5, 2, 7, 'connect', 'USER')
})

it.each(['missing-user', 'inactive-tenant', 'ended-session'] as const)('fails closed for %s', async scenario => {
  const { service, user, db, ssh } = setup(true)
  if (scenario === 'missing-user') db.user.findFirst.mockResolvedValue(null as never)
  if (scenario === 'inactive-tenant') db.user.findFirst.mockResolvedValue({ sessionVersion: 1, role: 'USER', tenant: { active: false } })
  if (scenario === 'ended-session') db.session.findFirst.mockResolvedValue(null as never)
  await expect(service.authorize(user, 8)).rejects.toThrow()
  expect(ssh.hasEffectiveHostPermission).not.toHaveBeenCalled()
})
it('filters the session list by effective host ACL without returning denied names', async () => {
  const { service, user, db, ssh } = setup(true)
  Object.assign(db.session, { findMany: vi.fn().mockResolvedValue([{ id: 1, hostId: 5 }, { id: 2, hostId: 6 }]) })
  Object.assign(ssh, { findHostIdsWithEffectivePermission: vi.fn().mockResolvedValue(new Set([5])) })
  await expect(service.list(user)).resolves.toEqual([{ id: 1, hostId: 5 }])
})
it('does not publish invalid terminal dimensions or persist terminal contents', async () => {
  const redis = { set: vi.fn().mockResolvedValue('OK'), publish: vi.fn().mockResolvedValue(0), del: vi.fn().mockResolvedValue(1) }
  const service = new SessionSupervisionService({} as never, redis as never, {} as never)
  for (const cols of [0, -1, 1001, NaN, 1.5]) service.publish(8, { cols, rows: 24 })
  expect(redis.publish).not.toHaveBeenCalled()
  service.publish(8, Buffer.from('redacted output'))
  expect(redis.set).not.toHaveBeenCalled()
  expect(redis.publish).toHaveBeenCalledWith('supervision:session:8', JSON.stringify({ data: Buffer.from('redacted output').toString('base64') }))
  service.publish(8, null)
  expect(redis.del).toHaveBeenCalledWith('supervision:dimensions:8')
  expect(redis.publish).toHaveBeenLastCalledWith('supervision:session:8', '{"ended":true}')
})
