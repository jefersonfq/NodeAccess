type CacheEntry<T> = {
  value: Promise<T>
  expiresAt: number
  pending: boolean
}

type CacheStats = {
  hits: number
  misses: number
  sets: number
  updates: number
  clears: number
  expirations: number
  evictions: number
  coalesced: number
  refreshErrors: number
  lastHitAt: number | null
  lastMissAt: number | null
  lastSetAt: number | null
  lastClearAt: number | null
}

type CacheRegistryItem = {
  name: string
  kind: 'timed' | 'keyed'
  getTtlMs: () => number
  setTtlMs: (ttlMs: number) => void
  resetTtl: () => void
  getEntryCount: () => number
  getInFlightCount: () => number
  clear: () => void
  refresh: () => Promise<void>
  canRefresh: () => boolean
  getStats: () => CacheStats
  getKeyInsights?: () => CacheKeyInsight[]
  getMeta?: () => CacheMetaSnapshot
}

type CacheOptions = {
  name?: string
  maxEntries?: number
  describeKey?: (key: any) => string
}

const MIN_RUNTIME_TTL_MS = 1_000
const MAX_RUNTIME_TTL_MS = 24 * 60 * 60_000
const CACHE_TTL_STORAGE_KEY = 'na_cache_ttl_overrides_v1'

function normalizeRuntimeTtl(ttlMs: number) {
  if (!Number.isFinite(ttlMs)) return MIN_RUNTIME_TTL_MS
  return Math.min(MAX_RUNTIME_TTL_MS, Math.max(MIN_RUNTIME_TTL_MS, Math.round(ttlMs)))
}

function readTtlOverrides(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_TTL_STORAGE_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
      .map(([name, value]) => [name, normalizeRuntimeTtl(value as number)]))
  } catch {
    return {}
  }
}

function writeTtlOverride(name: string, ttlMs: number | null) {
  if (typeof window === 'undefined') return
  const overrides = readTtlOverrides()
  if (ttlMs === null) delete overrides[name]
  else overrides[name] = normalizeRuntimeTtl(ttlMs)
  window.localStorage.setItem(CACHE_TTL_STORAGE_KEY, JSON.stringify(overrides))
}

export type CacheKeyInsight = {
  key: string
  label: string
  reads: number
  hits: number
  misses: number
  hitRate: number
  lastAccessAt: number | null
}

export type CacheMutationAction = 'clear' | 'set' | 'update' | 'refresh'

export type CacheMetaSnapshot = {
  lastMutationAction: CacheMutationAction | null
  lastMutationReason: string | null
  lastMutationAt: number | null
}

const cacheRegistry = new Map<string, CacheRegistryItem>()
const cacheRegistryListeners = new Set<() => void>()
const cacheChannelSource = Math.random().toString(36).slice(2)
let applyingRemoteMutation = false
const cacheChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('nodeaccess-cache-control-v1')
  : null

type CacheChannelMessage = {
  source: string
  action: 'invalidate' | 'invalidate-all' | 'ttl' | 'ttl-reset'
  name?: string
  ttlMs?: number
}

function broadcastCacheMessage(message: Omit<CacheChannelMessage, 'source'>) {
  if (!applyingRemoteMutation) cacheChannel?.postMessage({ source: cacheChannelSource, ...message })
}

function notifyCacheRegistryChanged() {
  for (const listener of cacheRegistryListeners) listener()
}

export function subscribeCacheRegistry(listener: () => void) {
  cacheRegistryListeners.add(listener)
  return () => cacheRegistryListeners.delete(listener)
}

if (cacheChannel) {
  cacheChannel.onmessage = (event: MessageEvent<CacheChannelMessage>) => {
    const message = event.data
    if (!message || message.source === cacheChannelSource) return
    applyingRemoteMutation = true
    try {
      if (message.action === 'invalidate-all') {
        for (const item of cacheRegistry.values()) item.clear()
      } else if (message.name) {
        const item = cacheRegistry.get(message.name)
        if (message.action === 'invalidate') item?.clear()
        if (message.action === 'ttl' && typeof message.ttlMs === 'number') item?.setTtlMs(normalizeRuntimeTtl(message.ttlMs))
        if (message.action === 'ttl-reset') item?.resetTtl()
      }
    } finally {
      applyingRemoteMutation = false
      notifyCacheRegistryChanged()
    }
  }
}

function createStats(): CacheStats {
  return {
    hits: 0,
    misses: 0,
    sets: 0,
    updates: 0,
    clears: 0,
    expirations: 0,
    evictions: 0,
    coalesced: 0,
    refreshErrors: 0,
    lastHitAt: null,
    lastMissAt: null,
    lastSetAt: null,
    lastClearAt: null,
  }
}

function cloneStats(stats: CacheStats): CacheStats {
  return { ...stats }
}

function registerCache(item: CacheRegistryItem) {
  cacheRegistry.set(item.name, item)
}

export type CacheRegistrySnapshot = {
  name: string
  kind: 'timed' | 'keyed'
  ttlMs: number
  entryCount: number
  inFlightCount: number
  stats: CacheStats
  totalReads: number
  hitRate: number
  lastActivityAt: number | null
  health: 'cold' | 'healthy' | 'warming' | 'attention'
  canRefresh: boolean
  keyInsights: CacheKeyInsight[]
  meta: CacheMetaSnapshot
}

export function listCacheRegistry(): CacheRegistrySnapshot[] {
  return Array.from(cacheRegistry.values())
    .map((item) => {
      const stats = item.getStats()
      const totalReads = stats.hits + stats.misses
      const lastActivityAt = Math.max(
        stats.lastHitAt ?? 0,
        stats.lastMissAt ?? 0,
        stats.lastSetAt ?? 0,
        stats.lastClearAt ?? 0,
      ) || null
      const health: CacheRegistrySnapshot['health'] =
        totalReads < 5
          ? 'cold'
          : totalReads >= 5 && stats.hits / totalReads < 0.4
            ? 'attention'
            : totalReads >= 5 && stats.hits / totalReads < 0.7
              ? 'warming'
              : 'healthy'

      return {
        name: item.name,
        kind: item.kind,
        ttlMs: item.getTtlMs(),
        entryCount: item.getEntryCount(),
        inFlightCount: item.getInFlightCount(),
        stats,
        totalReads,
        hitRate: totalReads > 0 ? stats.hits / totalReads : 0,
        lastActivityAt,
        health,
        canRefresh: item.canRefresh(),
        keyInsights: item.getKeyInsights?.() ?? [],
        meta: item.getMeta?.() ?? { lastMutationAction: null, lastMutationReason: null, lastMutationAt: null },
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function clearRegisteredCache(name: string) {
  cacheRegistry.get(name)?.clear()
}

export function setRegisteredCacheTtl(name: string, ttlMs: number) {
  const cache = cacheRegistry.get(name)
  if (!cache) return false
  const normalized = normalizeRuntimeTtl(ttlMs)
  cache.setTtlMs(normalized)
  writeTtlOverride(name, normalized)
  broadcastCacheMessage({ action: 'ttl', name, ttlMs: normalized })
  notifyCacheRegistryChanged()
  return true
}

export function resetRegisteredCacheTtl(name: string) {
  const cache = cacheRegistry.get(name)
  if (!cache) return false
  cache.resetTtl()
  broadcastCacheMessage({ action: 'ttl-reset', name })
  notifyCacheRegistryChanged()
  return true
}

export async function refreshRegisteredCache(name: string) {
  await cacheRegistry.get(name)?.refresh?.()
}

export function clearAllRegisteredCaches() {
  applyingRemoteMutation = true
  try {
    for (const item of cacheRegistry.values()) {
      item.clear()
    }
  } finally {
    applyingRemoteMutation = false
  }
  broadcastCacheMessage({ action: 'invalidate-all' })
  notifyCacheRegistryChanged()
}

export async function refreshAllRegisteredCaches() {
  for (const item of cacheRegistry.values()) {
    if (item.canRefresh()) {
      await item.refresh()
    }
  }
}

export function createTimedPromiseCache<T>(ttlMs: number, options: CacheOptions = {}) {
  const defaultTtlMs = ttlMs
  let currentTtlMs = options.name ? readTtlOverrides()[options.name] ?? ttlMs : ttlMs
  let entry: CacheEntry<T> | null = null
  let lastFactory: (() => Promise<T>) | null = null
  const stats = createStats()
  const meta: CacheMetaSnapshot = {
    lastMutationAction: null,
    lastMutationReason: null,
    lastMutationAt: null,
  }

  function recordMutation(action: CacheMutationAction, reason?: string) {
    meta.lastMutationAction = action
    meta.lastMutationReason = reason ?? null
    meta.lastMutationAt = Date.now()
  }

  function createResolvedEntry(value: T): CacheEntry<T> {
    return {
      value: Promise.resolve(value),
      expiresAt: Date.now() + currentTtlMs,
      pending: false,
    }
  }

  function isExpired(current: CacheEntry<T> | null) {
    return !!current && current.expiresAt <= Date.now()
  }

  function pruneExpiredEntry() {
    if (isExpired(entry)) {
      entry = null
      stats.expirations += 1
    }
  }

  function get(factory: () => Promise<T>): Promise<T> {
    lastFactory = factory
    pruneExpiredEntry()
    const now = Date.now()
    if (entry && entry.expiresAt > now) {
      if (entry.pending) stats.coalesced += 1
      stats.hits += 1
      stats.lastHitAt = now
      return entry.value
    }

    stats.misses += 1
    stats.lastMissAt = now

    const value = factory().then((result) => {
      if (entry?.value === value) entry.pending = false
      return result
    }).catch((error) => {
      if (entry?.value === value) {
        entry = null
      }
      throw error
    })

    entry = {
      value,
      expiresAt: now + currentTtlMs,
      pending: true,
    }
    stats.sets += 1
    stats.lastSetAt = now
    recordMutation('set', 'cache-miss')

    return value
  }

  function clear(reason?: string) {
    entry = null
    stats.clears += 1
    stats.lastClearAt = Date.now()
    recordMutation('clear', reason)
    if (options.name) broadcastCacheMessage({ action: 'invalidate', name: options.name })
    notifyCacheRegistryChanged()
  }

  function set(value: T, reason?: string) {
    entry = createResolvedEntry(value)
    stats.sets += 1
    stats.lastSetAt = Date.now()
    recordMutation('set', reason)
    if (options.name && reason !== 'cache-miss') broadcastCacheMessage({ action: 'invalidate', name: options.name })
    notifyCacheRegistryChanged()
  }

  async function update(updater: (current: T | null) => T | null | Promise<T | null>, reason?: string) {
    pruneExpiredEntry()
    const current = entry ? await entry.value.catch(() => null) : null
    const next = await updater(current)
    stats.updates += 1
    if (next === null) {
      clear(reason)
      return
    }
    set(next, reason)
    recordMutation('update', reason)
  }

  async function getCached() {
    pruneExpiredEntry()
    if (!entry || entry.expiresAt <= Date.now()) return null
    try {
      return await entry.value
    } catch {
      entry = null
      return null
    }
  }

  async function refresh() {
    if (!lastFactory) return
    try {
      const value = await lastFactory()
      set(value, 'manual-refresh')
      recordMutation('refresh', 'manual-refresh')
    } catch (error) {
      stats.refreshErrors += 1
      throw error
    }
  }

  if (options.name) {
    registerCache({
      name: options.name,
      kind: 'timed',
      getTtlMs: () => currentTtlMs,
      setTtlMs: (nextTtlMs) => {
        currentTtlMs = normalizeRuntimeTtl(nextTtlMs)
        clear('ttl-change')
      },
      resetTtl: () => {
        currentTtlMs = defaultTtlMs
        writeTtlOverride(options.name!, null)
        clear('ttl-reset')
      },
      getEntryCount: () => {
        pruneExpiredEntry()
        return entry ? 1 : 0
      },
      getInFlightCount: () => entry?.pending ? 1 : 0,
      clear,
      refresh,
      canRefresh: () => lastFactory !== null,
      getStats: () => cloneStats(stats),
      getMeta: () => ({ ...meta }),
    })
  }

  return {
    get,
    clear,
    set,
    update,
    getCached,
    resetTtl: () => {
      currentTtlMs = defaultTtlMs
      if (options.name) writeTtlOverride(options.name, null)
      clear('ttl-reset')
    },
  }
}

export function createKeyedTimedPromiseCache<K, T>(ttlMs: number, keyFn: (key: K) => string, options: CacheOptions = {}) {
  const defaultTtlMs = ttlMs
  let currentTtlMs = options.name ? readTtlOverrides()[options.name] ?? ttlMs : ttlMs
  const entries = new Map<string, CacheEntry<T>>()
  const keys = new Map<string, K>()
  const factories = new Map<string, () => Promise<T>>()
  const stats = createStats()
  const meta: CacheMetaSnapshot = {
    lastMutationAction: null,
    lastMutationReason: null,
    lastMutationAt: null,
  }
  const keyStats = new Map<string, { label: string; hits: number; misses: number; lastAccessAt: number | null }>()

  function recordMutation(action: CacheMutationAction, reason?: string) {
    meta.lastMutationAction = action
    meta.lastMutationReason = reason ?? null
    meta.lastMutationAt = Date.now()
  }

  function createResolvedEntry(value: T): CacheEntry<T> {
    return {
      value: Promise.resolve(value),
      expiresAt: Date.now() + currentTtlMs,
      pending: false,
    }
  }

  function removeCacheKey(cacheKey: string) {
    entries.delete(cacheKey)
    keys.delete(cacheKey)
    factories.delete(cacheKey)
  }

  function describeKey(cacheKey: string, key: K) {
    return options.describeKey?.(key) ?? cacheKey
  }

  function pruneKeyStats() {
    const maxKeyInsights = Math.max(options.maxEntries ?? 10, 10)
    if (keyStats.size <= maxKeyInsights) return
    const sorted = Array.from(keyStats.entries())
      .sort((a, b) => (b[1].lastAccessAt ?? 0) - (a[1].lastAccessAt ?? 0))
      .slice(0, maxKeyInsights)
    keyStats.clear()
    for (const [cacheKey, value] of sorted) {
      keyStats.set(cacheKey, value)
    }
  }

  function trackKeyAccess(cacheKey: string, key: K, outcome: 'hit' | 'miss', timestamp: number) {
    const current = keyStats.get(cacheKey) ?? {
      label: describeKey(cacheKey, key),
      hits: 0,
      misses: 0,
      lastAccessAt: null,
    }
    current.label = describeKey(cacheKey, key)
    current.lastAccessAt = timestamp
    if (outcome === 'hit') current.hits += 1
    else current.misses += 1
    keyStats.set(cacheKey, current)
    pruneKeyStats()
  }

  function pruneExpiredEntries() {
    const now = Date.now()
    for (const [cacheKey, entry] of entries.entries()) {
      if (entry.expiresAt <= now) {
        removeCacheKey(cacheKey)
        stats.expirations += 1
      }
    }
  }

  function touchCacheKey(cacheKey: string, key: K, factory?: () => Promise<T>) {
    const currentEntry = entries.get(cacheKey)
    if (currentEntry) {
      entries.delete(cacheKey)
      entries.set(cacheKey, currentEntry)
    }

    keys.delete(cacheKey)
    keys.set(cacheKey, key)

    if (factory) {
      factories.delete(cacheKey)
      factories.set(cacheKey, factory)
    } else {
      const currentFactory = factories.get(cacheKey)
      if (currentFactory) {
        factories.delete(cacheKey)
        factories.set(cacheKey, currentFactory)
      }
    }
  }

  function evictOverflow() {
    if (!options.maxEntries || entries.size <= options.maxEntries) return
    while (entries.size > options.maxEntries) {
      const oldestCacheKey = entries.keys().next().value
      if (!oldestCacheKey) break
      removeCacheKey(oldestCacheKey)
      stats.evictions += 1
    }
  }

  function get(key: K, factory: () => Promise<T>): Promise<T> {
    pruneExpiredEntries()
    const cacheKey = keyFn(key)
    keys.set(cacheKey, key)
    factories.set(cacheKey, factory)
    const current = entries.get(cacheKey)
    const now = Date.now()
    if (current && current.expiresAt > now) {
      if (current.pending) stats.coalesced += 1
      touchCacheKey(cacheKey, key, factory)
      stats.hits += 1
      stats.lastHitAt = now
      trackKeyAccess(cacheKey, key, 'hit', now)
      return current.value
    }

    stats.misses += 1
    stats.lastMissAt = now
    trackKeyAccess(cacheKey, key, 'miss', now)

    const value = factory().then((result) => {
      const latest = entries.get(cacheKey)
      if (latest?.value === value) latest.pending = false
      return result
    }).catch((error) => {
      const latest = entries.get(cacheKey)
      if (latest?.value === value) {
        entries.delete(cacheKey)
      }
      throw error
    })

    entries.set(cacheKey, {
      value,
      expiresAt: now + currentTtlMs,
      pending: true,
    })
    stats.sets += 1
    stats.lastSetAt = now
    recordMutation('set', 'cache-miss')
    touchCacheKey(cacheKey, key, factory)
    evictOverflow()
    return value
  }

  function set(key: K, value: T, reason?: string) {
    const cacheKey = keyFn(key)
    entries.set(cacheKey, createResolvedEntry(value))
    touchCacheKey(cacheKey, key)
    evictOverflow()
    stats.sets += 1
    stats.lastSetAt = Date.now()
    recordMutation('set', reason)
    if (options.name) broadcastCacheMessage({ action: 'invalidate', name: options.name })
    notifyCacheRegistryChanged()
  }

  async function update(key: K, updater: (current: T | null) => T | null | Promise<T | null>, reason?: string) {
    pruneExpiredEntries()
    const cacheKey = keyFn(key)
    const current = entries.get(cacheKey)
    const resolved = current ? await current.value.catch(() => null) : null
    const next = await updater(resolved)
    stats.updates += 1
    if (next === null) {
      removeCacheKey(cacheKey)
      stats.clears += 1
      stats.lastClearAt = Date.now()
      recordMutation('clear', reason)
      if (options.name) broadcastCacheMessage({ action: 'invalidate', name: options.name })
      notifyCacheRegistryChanged()
      return
    }
    entries.set(cacheKey, createResolvedEntry(next))
    touchCacheKey(cacheKey, key)
    evictOverflow()
    stats.sets += 1
    stats.lastSetAt = Date.now()
    recordMutation('update', reason)
    if (options.name) broadcastCacheMessage({ action: 'invalidate', name: options.name })
    notifyCacheRegistryChanged()
  }

  function clear(key?: K, reason?: string) {
    if (typeof key === 'undefined') {
      entries.clear()
      keys.clear()
      factories.clear()
      keyStats.clear()
    } else {
      const cacheKey = keyFn(key)
      removeCacheKey(cacheKey)
      keyStats.delete(cacheKey)
    }
    stats.clears += 1
    stats.lastClearAt = Date.now()
    recordMutation('clear', reason)
    if (options.name) broadcastCacheMessage({ action: 'invalidate', name: options.name })
    notifyCacheRegistryChanged()
  }

  async function getCached(key: K) {
    pruneExpiredEntries()
    const cacheKey = keyFn(key)
    const current = entries.get(cacheKey)
    if (!current || current.expiresAt <= Date.now()) return null
    try {
      touchCacheKey(cacheKey, key)
      return await current.value
    } catch {
      removeCacheKey(cacheKey)
      return null
    }
  }

  async function refresh() {
    const refreshTargets = Array.from(factories.entries())
    try {
      await Promise.all(refreshTargets.map(async ([cacheKey, factory]) => {
        const next = await factory()
        entries.set(cacheKey, createResolvedEntry(next))
        stats.sets += 1
        stats.lastSetAt = Date.now()
      }))
      recordMutation('refresh', 'manual-refresh')
      if (options.name) broadcastCacheMessage({ action: 'invalidate', name: options.name })
      notifyCacheRegistryChanged()
    } catch (error) {
      stats.refreshErrors += 1
      throw error
    }
  }

  if (options.name) {
    registerCache({
      name: options.name,
      kind: 'keyed',
      getTtlMs: () => currentTtlMs,
      setTtlMs: (nextTtlMs) => {
        currentTtlMs = normalizeRuntimeTtl(nextTtlMs)
        clear(undefined, 'ttl-change')
      },
      resetTtl: () => {
        currentTtlMs = defaultTtlMs
        writeTtlOverride(options.name!, null)
        clear(undefined, 'ttl-reset')
      },
      getEntryCount: () => {
        pruneExpiredEntries()
        return entries.size
      },
      getInFlightCount: () => Array.from(entries.values()).filter((entry) => entry.pending).length,
      clear: () => clear(),
      refresh,
      canRefresh: () => factories.size > 0,
      getStats: () => cloneStats(stats),
      getMeta: () => ({ ...meta }),
      getKeyInsights: () => Array.from(keyStats.entries())
        .map(([key, value]) => {
          const reads = value.hits + value.misses
          return {
            key,
            label: value.label,
            reads,
            hits: value.hits,
            misses: value.misses,
            hitRate: reads > 0 ? value.hits / reads : 0,
            lastAccessAt: value.lastAccessAt,
          }
        })
        .sort((a, b) => b.reads - a.reads)
        .slice(0, 5),
    })
  }

  return {
    get,
    getCached,
    set,
    update,
    clear,
    resetTtl: () => {
      currentTtlMs = defaultTtlMs
      if (options.name) writeTtlOverride(options.name, null)
      clear(undefined, 'ttl-reset')
    },
  }
}
