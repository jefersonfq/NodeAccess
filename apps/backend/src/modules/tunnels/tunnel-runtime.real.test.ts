import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../config/logger.js', () => ({ logger: { warn: vi.fn() } }))
import { TunnelRuntimeRegistry } from './tunnel-runtime.registry.js'
import type { TunnelInfo } from './tunnel.service.js'

describe.runIf(process.env.RUN_TUNNEL_REDIS_REAL === 'true')('real Redis tunnel coordination', () => {
  it('discovers, isolates and closes across independent subscribers without leaking namespace keys', async () => {
    const redis = new Redis(process.env.TUNNEL_TEST_REDIS_URL || 'redis://127.0.0.1:16389', { lazyConnect: true, maxRetriesPerRequest: 1 })
    const namespace = 'nodeaccess:test:tunnels:' + randomUUID()
    let rows = [{ id: randomUUID(), userId: 1, tenantId: 7, hostId: 10 }] as TunnelInfo[]
    const api = new TunnelRuntimeRegistry(redis, () => [], async () => { throw Error('Wrong owner') }, namespace)
    const gateway = new TunnelRuntimeRegistry(redis, () => rows, async (id, user, tenant) => {
      const row = rows.find(row => row.id === id && row.userId === user && row.tenantId === tenant)
      if (!row) throw Error('Forbidden')
      rows = rows.filter(row => row.id !== id)
    }, namespace)
    try {
      await redis.connect(); await api.start(); await gateway.start()
      expect(await api.list(1, 7)).toMatchObject([{ id: rows[0]!.id, runtimeId: gateway.id }])
      expect(await api.list(2, 7)).toEqual([])
      expect(await api.list(1, 8)).toEqual([])
      await api.close(rows[0]!.id, 1, 7)
      expect(rows).toEqual([])
      expect(await api.list(1, 7)).toEqual([])
      await gateway.stop()
      expect(await api.list(1, 7)).toEqual([])
    } finally {
      await api.stop(); await gateway.stop()
      expect(await redis.zcard(namespace)).toBe(0)
      await redis.del(namespace)
      await redis.quit()
    }
  }, 15000)
})
