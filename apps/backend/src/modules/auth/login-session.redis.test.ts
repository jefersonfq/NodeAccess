import { Redis } from 'ioredis'
import { afterAll, describe, expect, it } from 'vitest'
import { LoginSessionRegistry, loginSessionRef } from './login-session.registry.js'

/** NA-0187 — same registry against a real, disposable Redis (opt-in: LOGIN_SESSIONS_REDIS_URL). */
const url = process.env.LOGIN_SESSIONS_REDIS_URL
const run = url ? describe : describe.skip
run('NA-0187 login session registry on real Redis', () => {
  const redis = new Redis(url ?? 'redis://127.0.0.1:1', { lazyConnect: true, maxRetriesPerRequest: 1 })
  afterAll(async () => { await redis.flushdb(); redis.disconnect() })
  it('records, touches, lists, counts online and revokes with real command syntax', async () => {
    await redis.flushdb()
    let now = Date.now()
    const registry = new LoginSessionRegistry(redis, () => now), j = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    for (const n of [1, 2]) { await redis.set(`refresh:${j(n)}`, '7', 'EX', 3600); await registry.record(j(n), { userId: 41, tenantId: 7, authMethod: 'local' }, { ip: '203.0.113.10', userAgent: 'ua' }, 3600) }
    expect(await redis.ttl('login-sessions:7')).toBeGreaterThan(3500)
    expect(await redis.ttl(`login-session:${j(1)}`)).toBeGreaterThan(3500)
    now += 61_000
    await registry.touch(j(1), { userId: 41, tenantId: 7, authMethod: 'local' }, { ip: '192.0.2.5' })
    expect(await redis.ttl(`login-session:${j(1)}`)).toBeGreaterThan(3500)
    const list = await registry.list(7, 41, j(2))
    expect(list.find(s => s.ref === loginSessionRef(j(1)))).toMatchObject({ lastIp: '192.0.2.5', current: false })
    expect(await registry.online(7)).toEqual([{ userId: 41, sessions: 2, lastSeenAt: now }])
    expect((await registry.revoke(7, 41, loginSessionRef(j(1)), j(2))).state).toBe('revoked')
    expect(await registry.isActive(j(1))).toBe(false); expect(await registry.isActive(j(2))).toBe(true)
    await registry.forget(j(2)); expect(await redis.zcard('login-sessions:7')).toBe(0)
    // A touch after the record is gone must not recreate it without a TTL.
    now += 61_000; await redis.set(`login-session:${j(9)}`, JSON.stringify({ userId: 41, tenantId: 7, authMethod: 'local', ip: null, userAgent: null, lastIp: null, createdAt: 0, lastSeenAt: 0 }), 'EX', 60)
    const raw = await redis.get(`login-session:${j(9)}`); await redis.del(`login-session:${j(9)}`)
    await redis.set(`login-session:${j(9)}`, raw!, 'KEEPTTL', 'XX'); expect(await redis.exists(`login-session:${j(9)}`)).toBe(0)
  })
})
