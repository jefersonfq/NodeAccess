import { beforeEach, describe, expect, it } from 'vitest'
import { getBackendCacheStats, recordBackendCacheOperation, resetBackendCacheStats } from './cache-observability.js'

describe('backend cache observability', () => {
  beforeEach(() => resetBackendCacheStats())

  it('aggregates cache activity without tenant or user dimensions', () => {
    recordBackendCacheOperation('host_dashboard', 'read', 'hit', 2)
    recordBackendCacheOperation('host_dashboard', 'read', 'miss', 4)
    recordBackendCacheOperation('host_dashboard', 'write', 'success', 3)
    recordBackendCacheOperation('host_dashboard', 'read', 'error', 1)

    expect(getBackendCacheStats().find((item) => item.domain === 'host_dashboard')).toMatchObject({
      hits: 1,
      misses: 1,
      writes: 1,
      errors: 1,
      operations: 4,
      hitRate: 0.5,
      averageDurationMs: 2.5,
    })
  })

  it('returns stable zero-value domains for a cold process', () => {
    expect(getBackendCacheStats()).toHaveLength(3)
    expect(getBackendCacheStats()).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'user_dashboard', operations: 0, hitRate: null }),
      expect.objectContaining({ domain: 'host_sidebar', operations: 0, hitRate: null }),
    ]))
  })
})
