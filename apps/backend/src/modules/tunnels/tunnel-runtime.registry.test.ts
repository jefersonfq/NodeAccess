import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../config/logger.js', () => ({ logger: { warn: vi.fn() } }))
import { TunnelRuntimeRegistry } from './tunnel-runtime.registry.js'
import type { TunnelInfo } from './tunnel.service.js'

function redisFixture() {
  const strings = new Map<string, { raw: string; expires: number }>(), scores = new Map<string, number>()
  const subscribers = new Set<FakeRedis>()
  class FakeRedis extends EventEmitter {
    channels = new Set<string>()
    duplicate() { return new FakeRedis() }
    async connect() { subscribers.add(this) }
    async subscribe(channel: string) { this.channels.add(channel) }
    disconnect() { subscribers.delete(this) }
    async publish(channel: string, raw: string) { for (const sub of subscribers) if (sub.channels.has(channel)) sub.emit('message', channel, raw) }
    async set(key: string, raw: string, _px: string, ttl: number) { strings.set(key, { raw, expires: Date.now() + ttl }) }
    async zadd(_key: string, score: number, id: string) { scores.set(id, score) }
    async zrangebyscore(_key: string, min: number) { return [...scores].filter(([,score]) => score >= min).map(([id]) => id) }
    async mget(...keys: string[]) { return keys.map(key => { const value = strings.get(key); return value && value.expires > Date.now() ? value.raw : null }) }
    async del(key: string) { strings.delete(key) }
    async zremrangebyscore(_key: string, _min: string, max: number) { for (const [id, score] of scores) if (score <= max) scores.delete(id) }
    async zrem(_key: string, id: string) { scores.delete(id) }
  }
  return new FakeRedis()
}
const running: TunnelRuntimeRegistry[] = []
afterEach(async () => { for (const registry of running.splice(0)) await registry.stop(); vi.useRealTimers() })
function setup() {
  const redis = redisFixture()
  const rows = [{ id: 't1', userId: 1, tenantId: 7, hostId: 10 }] as TunnelInfo[]
  const close = vi.fn(async (id, userId, tenantId) => {
    const index = rows.findIndex(row => row.id === id && row.userId === userId && row.tenantId === tenantId)
    if (index < 0) throw new Error('Forbidden')
    rows.splice(index, 1)
  })
  const api = new TunnelRuntimeRegistry(redis as never, () => [], vi.fn())
  const gateway = new TunnelRuntimeRegistry(redis as never, () => rows, close)
  running.push(api, gateway)
  return { redis, rows, close, api, gateway }
}
describe('tunnel runtime discovery and control', () => {
  it('lists and closes a gateway tunnel from a separate API runtime with owner acknowledgement', async () => {
    const { api, gateway, close } = setup()
    await api.start(); await gateway.start()
    expect(await api.list(1, 7)).toMatchObject([{ id: 't1', runtimeId: gateway.id }])
    await api.close('t1', 1, 7)
    expect(close).toHaveBeenCalledWith('t1', 1, 7)
    expect(await api.list(1, 7)).toEqual([])
  })
  it('isolates user and tenant on both inventory and control', async () => {
    const { api, gateway, close } = setup()
    await api.start(); await gateway.start()
    expect(await api.list(2, 7)).toEqual([])
    expect(await api.list(1, 8)).toEqual([])
    await expect(api.close('t1', 2, 7)).rejects.toMatchObject({ statusCode: 404 })
    await expect(api.close('t1', 1, 8)).rejects.toMatchObject({ statusCode: 404 })
    expect(close).not.toHaveBeenCalled()
  })
  it('does not report success if the owning runtime cannot close', async () => {
    const { api, gateway, close } = setup()
    await api.start(); await gateway.start()
    close.mockRejectedValueOnce(new Error('failed'))
    await expect(api.close('t1', 1, 7)).rejects.toMatchObject({ code: 'TUNNEL_RUNTIME_CLOSE_FAILED' })
    expect(await api.list(1, 7)).toHaveLength(1)
  })
  it('reports timeout instead of silently dropping an unacknowledged close', async () => {
    const { api, gateway, redis } = setup()
    await api.start(); await gateway.start()
    vi.spyOn(redis, 'publish').mockResolvedValue(undefined)
    await expect(api.close('t1', 1, 7, 10)).rejects.toMatchObject({ code: 'TUNNEL_RUNTIME_TIMEOUT' })
  })
  it('excludes expired snapshots after an owner crash', async () => {
    const { api, gateway } = setup()
    await api.start(); await gateway.start()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16000)
    expect(await api.list(1, 7)).toEqual([])
    clock.mockRestore()
  })
  it('preserves a query failure as unavailable instead of an empty inventory', async () => {
    const { api, redis } = setup()
    vi.spyOn(redis, 'zrangebyscore').mockRejectedValue(new Error('offline'))
    await expect(api.list(1, 7)).rejects.toMatchObject({ code: 'TUNNEL_RUNTIME_UNAVAILABLE' })
  })
})
