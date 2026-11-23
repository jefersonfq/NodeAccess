import { describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'
import { LoginSessionRegistry, loginSessionRef, ONLINE_WINDOW_MS } from './login-session.registry.js'

/** Minimal in-memory Redis with the commands the registry uses; time is driven by the test. */
function fakeRedis(clock: { now: number }) {
  const strings = new Map<string, { value: string; until: number | null }>(), zsets = new Map<string, Map<string, number>>()
  const ttls = new Map<string, number>()
  const live = (k: string) => { const e = strings.get(k); if (e && e.until !== null && e.until <= clock.now) strings.delete(k); return strings.get(k) }
  const z = (k: string) => { let s = zsets.get(k); if (!s) { s = new Map(); zsets.set(k, s) } return s }
  const cmd = {
    get: (k: string) => live(k)?.value ?? null,
    set: (k: string, v: string, mode?: string, ttl?: number | string) => {
      if (ttl === 'XX' && !live(k)) return null
      const keep = mode === 'KEEPTTL' ? live(k)?.until ?? null : null
      strings.set(k, { value: v, until: mode === 'EX' ? clock.now + ttl! * 1000 : keep }); return 'OK'
    },
    del: (...keys: string[]) => keys.filter(k => strings.delete(k) || zsets.delete(k)).length,
    exists: (k: string) => (live(k) ? 1 : 0),
    ttl: (k: string) => { const e = live(k); if (e) return e.until === null ? -1 : Math.ceil((e.until - clock.now) / 1000); return zsets.has(k) ? ttls.get(k) ?? -1 : -2 },
    expire: (k: string, s: number) => { ttls.set(k, s); return 1 },
    zadd: (k: string, ...args: Array<string | number>) => {
      const xx = args[0] === 'XX'; const [score, member] = (xx ? args.slice(1) : args) as [number, string]
      if (xx && !z(k).has(member)) return 0
      z(k).set(member, Number(score)); return 1
    },
    zrem: (k: string, ...members: string[]) => members.filter(m => z(k).delete(m)).length,
    zremrangebyscore: (k: string, min: number, max: number) => { let n = 0; for (const [m, s] of z(k)) if (s >= min && s <= max) { z(k).delete(m); n++ } return n },
    zrevrangebyscore: (k: string, _max: string, min: number, _l: string, _o: number, count: number) =>
      [...z(k)].filter(([, s]) => s >= min).sort((a, b) => b[1] - a[1]).slice(0, count).map(([m]) => m),
  }
  const batch = () => {
    const queued: Array<() => unknown> = []
    const proxy: Record<string, unknown> = { exec: () => Promise.resolve(queued.map(run => [null, run()])) }
    for (const [name, fn] of Object.entries(cmd)) proxy[name] = (...a: unknown[]) => { queued.push(() => (fn as (...x: unknown[]) => unknown)(...a)); return proxy }
    return proxy
  }
  const redis = Object.fromEntries(Object.entries(cmd).map(([name, fn]) => [name, (...a: unknown[]) => Promise.resolve((fn as (...x: unknown[]) => unknown)(...a))]))
  return { redis: { ...redis, multi: batch, pipeline: batch } as unknown as Redis, strings, zsets }
}
const jti = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const owner = (userId: number, tenantId = 7) => ({ userId, tenantId, authMethod: 'local' as const })
function setup() {
  const clock = { now: 1_000_000 }, f = fakeRedis(clock), registry = new LoginSessionRegistry(f.redis, () => clock.now)
  const login = async (id: number, userId: number, tenantId = 7, ip = '203.0.113.10') => {
    f.strings.set(`refresh:${jti(id)}`, { value: String(tenantId), until: clock.now + 3_600_000 })
    await registry.record(jti(id), owner(userId, tenantId), { ip, userAgent: 'Mozilla/5.0 '.repeat(40) }, 3600)
  }
  return { clock, f, registry, login }
}

describe('NA-0187 login session registry', () => {
  it('records IP, browser and method per refresh token and lists them by opaque reference only', async () => {
    const { registry, login } = setup()
    await login(1, 41); await login(2, 41, 7, '198.51.100.7'); await login(3, 42)
    const sessions = await registry.list(7, 41, jti(2))
    expect(sessions).toHaveLength(2)
    expect(sessions.map(s => s.ip).sort()).toEqual(['198.51.100.7', '203.0.113.10'])
    expect(sessions.find(s => s.current)?.ref).toBe(loginSessionRef(jti(2)))
    expect(JSON.stringify(sessions)).not.toContain(jti(1))
    expect(sessions[0]!.userAgent!.length).toBeLessThanOrEqual(256)
  })
  it('counts online users within the window and prunes sessions whose refresh token is gone', async () => {
    const { registry, login, clock, f } = setup()
    await login(1, 41); await login(2, 41); await login(3, 42)
    clock.now += ONLINE_WINDOW_MS - 1
    await login(4, 43)
    expect((await registry.online(7)).map(u => [u.userId, u.sessions]).sort()).toEqual([[41, 2], [42, 1], [43, 1]])
    clock.now += 2
    expect((await registry.online(7)).map(u => u.userId)).toEqual([43])
    f.strings.delete(`refresh:${jti(4)}`)
    expect(await registry.online(7)).toEqual([])
    expect(f.zsets.get('login-sessions:7')?.has(`43:${jti(4)}`)).toBe(false)
  })
  it('keeps tenants apart', async () => {
    const { registry, login } = setup()
    await login(1, 41, 7); await login(2, 41, 8)
    expect(await registry.list(8, 41)).toHaveLength(1)
    expect((await registry.revoke(7, 41, loginSessionRef(jti(2)))).state).toBe('missing')
    expect(await registry.isActive(jti(2))).toBe(true)
  })
  it('touch updates last use at most once a minute unless the IP changes, and backfills older sessions', async () => {
    const { registry, login, clock, f } = setup()
    await login(1, 41)
    clock.now += 30_000; await registry.touch(jti(1), owner(41), { ip: '203.0.113.10' })
    expect((await registry.list(7, 41))[0]!.lastSeenAt).toBe(1_000_000)
    await registry.touch(jti(1), owner(41), { ip: '192.0.2.5' })
    expect((await registry.list(7, 41))[0]).toMatchObject({ lastIp: '192.0.2.5', ip: '203.0.113.10', lastSeenAt: 1_030_000 })
    await registry.touch(jti(1), owner(99), { ip: '192.0.2.99' })
    expect((await registry.list(7, 41))[0]!.lastIp).toBe('192.0.2.5')
    f.strings.set(`refresh:${jti(5)}`, { value: '7', until: clock.now + 60_000 })
    await registry.touch(jti(5), owner(44), { ip: '192.0.2.44' })
    expect(await registry.list(7, 44)).toEqual([expect.objectContaining({ ip: '192.0.2.44', authMethod: 'local' })])
    await registry.touch(jti(6), owner(45), {})
    expect(await registry.list(7, 45)).toEqual([])
  })
  it('revokes exactly one session (refresh token first), never the current one, and forget() clears on logout', async () => {
    const { registry, login, f } = setup()
    await login(1, 41); await login(2, 41)
    expect((await registry.revoke(7, 41, loginSessionRef(jti(1)), jti(1))).state).toBe('current')
    const result = await registry.revoke(7, 41, loginSessionRef(jti(1)), jti(2))
    expect(result).toMatchObject({ state: 'revoked', record: { ip: '203.0.113.10', userId: 41 } })
    expect(await registry.isActive(jti(1))).toBe(false); expect(await registry.isActive(jti(2))).toBe(true)
    expect((await registry.revoke(7, 41, loginSessionRef(jti(1)))).state).toBe('missing')
    expect((await registry.revoke(7, 42, loginSessionRef(jti(2)))).state).toBe('missing')
    await registry.forget(jti(2))
    expect(f.strings.has(`login-session:${jti(2)}`)).toBe(false)
    expect(f.zsets.get('login-sessions:7')?.size).toBe(0)
  })
  it('a touch racing a disconnect never recreates the removed record', async () => {
    const { registry, login, clock, f } = setup()
    await login(1, 41); clock.now += 61_000
    const get = f.redis.get.bind(f.redis)
    f.redis.get = (async (k: string) => { const v = await get(k); f.strings.delete(`login-session:${jti(1)}`); return v })
    await registry.touch(jti(1), owner(41), { ip: '192.0.2.9' })
    expect(f.strings.has(`login-session:${jti(1)}`)).toBe(false)
  })
  it('ignores malformed ids and invalid lifetimes', async () => {
    const { registry, f } = setup()
    await registry.record('not-a-uuid', owner(1), {}, 60); await registry.record(jti(1), owner(1), {}, 0)
    await registry.touch('x', owner(1), {}); await registry.forget('x')
    expect(f.strings.size).toBe(0); expect(await registry.isActive('refresh-anything')).toBe(false)
  })
})
