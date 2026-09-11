import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createKeyedTimedPromiseCache,
  createTimedPromiseCache,
  listCacheRegistry,
  refreshRegisteredCache,
  setRegisteredCacheTtl,
} from './service-cache'

afterEach(() => {
  vi.useRealTimers()
})

describe('service cache runtime behavior', () => {
  it('coalesces concurrent requests and reports the operation', async () => {
    let resolve!: (value: string) => void
    const factory = vi.fn(() => new Promise<string>((done) => { resolve = done }))
    const cache = createTimedPromiseCache<string>(30_000, { name: 'test:coalescing' })

    const first = cache.get(factory)
    const second = cache.get(factory)
    expect(first).toBe(second)
    expect(listCacheRegistry().find((row) => row.name === 'test:coalescing')).toMatchObject({
      inFlightCount: 1,
      stats: { misses: 1, hits: 1, coalesced: 1 },
    })

    resolve('ok')
    await expect(first).resolves.toBe('ok')
  })

  it('applies a runtime TTL immediately and expires existing data safely', async () => {
    vi.useFakeTimers()
    const factory = vi.fn().mockResolvedValue('fresh')
    const cache = createTimedPromiseCache<string>(30_000, { name: 'test:runtime-ttl' })
    await cache.get(factory)

    expect(setRegisteredCacheTtl('test:runtime-ttl', 1_000)).toBe(true)
    expect(listCacheRegistry().find((row) => row.name === 'test:runtime-ttl')?.ttlMs).toBe(1_000)
    await cache.get(factory)
    await vi.advanceTimersByTimeAsync(1_001)
    await cache.get(factory)

    expect(factory).toHaveBeenCalledTimes(3)
    expect(listCacheRegistry().find((row) => row.name === 'test:runtime-ttl')?.stats.expirations).toBe(1)
  })

  it('bounds keyed caches and reports LRU evictions', async () => {
    const cache = createKeyedTimedPromiseCache<number, number>(30_000, String, {
      name: 'test:lru',
      maxEntries: 2,
    })
    await cache.get(1, async () => 1)
    await cache.get(2, async () => 2)
    await cache.get(3, async () => 3)

    expect(listCacheRegistry().find((row) => row.name === 'test:lru')).toMatchObject({
      entryCount: 2,
      stats: { evictions: 1 },
    })
  })

  it('preserves the previous value and reports a failed manual refresh', async () => {
    const factory = vi.fn().mockResolvedValueOnce('cached').mockRejectedValueOnce(new Error('offline'))
    const cache = createTimedPromiseCache<string>(30_000, { name: 'test:refresh-error' })
    await cache.get(factory)

    await expect(refreshRegisteredCache('test:refresh-error')).rejects.toThrow('offline')
    await expect(cache.getCached()).resolves.toBe('cached')
    expect(listCacheRegistry().find((row) => row.name === 'test:refresh-error')?.stats.refreshErrors).toBe(1)
  })
})
