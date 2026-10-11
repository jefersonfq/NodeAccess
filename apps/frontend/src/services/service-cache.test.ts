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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

for (const kind of ['timed', 'keyed'] as const) {
  function make(name: string) {
    if (kind === 'timed') return createTimedPromiseCache<string>(1_000, { name })
    const keyed = createKeyedTimedPromiseCache<string, string>(1_000, String, { name })
    return { get: (factory: () => Promise<string>) => keyed.get('hosts', factory), set: (value: string) => keyed.set('hosts', value), clear: () => keyed.clear(), getCached: () => keyed.getCached('hosts'), update: (updater: (current: string | null) => Promise<string>) => keyed.update('hosts', updater) }
  }
  describe(`${kind} cache invalidation`, () => {
    it('does not restore old tenant data after refresh and logout/context change', async () => {
      const name = `test:${kind}:refresh-context`
      const cache = make(name)
      const old = deferred<string>()
      const factory = vi.fn().mockResolvedValueOnce('tenant-a').mockReturnValueOnce(old.promise)
      await cache.get(factory)
      const refresh = refreshRegisteredCache(name)
      cache.clear()
      cache.set('tenant-b')
      old.resolve('old-tenant-a')
      await refresh
      await expect(cache.getCached()).resolves.toBe('tenant-b')
    })
    it('does not restore data after an asynchronous update is invalidated', async () => {
      const cache = make(`test:${kind}:update-context`)
      cache.set('tenant-a')
      const old = deferred<string>()
      const update = cache.update(() => old.promise)
      await Promise.resolve(); await Promise.resolve()
      cache.clear()
      old.resolve('old-tenant-a')
      await update
      await expect(cache.getCached()).resolves.toBeNull()
    })
    it('keeps a pending request coalesced beyond TTL and starts TTL at resolution', async () => {
      vi.useFakeTimers()
      const cache = make(`test:${kind}:pending`)
      const old = deferred<string>()
      const factory = vi.fn(() => old.promise)
      const first = cache.get(factory)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(cache.get(factory)).toBe(first)
      old.resolve('fresh')
      await first
      await vi.advanceTimersByTimeAsync(900)
      await expect(cache.getCached()).resolves.toBe('fresh')
      expect(factory).toHaveBeenCalledTimes(1)
    })
    it('an old rejected read cannot remove a replacement entry', async () => {
      const cache = make(`test:${kind}:rejection`)
      const old = deferred<string>()
      const first = cache.get(() => old.promise).catch(() => null)
      const read = cache.getCached()
      cache.clear(); cache.set('tenant-b')
      old.reject(new Error('offline'))
      await first; await read
      await expect(cache.getCached()).resolves.toBe('tenant-b')
    })
    it('does not return an invalidated pending entry through getCached', async () => {
      const cache = make(`test:${kind}:late-read`)
      const old = deferred<string>()
      const first = cache.get(() => old.promise)
      const read = cache.getCached()
      cache.clear(); cache.set('tenant-b'); old.resolve('tenant-a')
      await first
      await expect(read).resolves.toBeNull()
    })
  })
}
