import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('HTTP performance collection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'mysql://user:password@localhost:3306/nodeaccess')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('JWT_SECRET', 'x'.repeat(64))
    vi.stubEnv('PEM_ENCRYPTION_KEY', '0'.repeat(64))
    vi.stubEnv('SLOW_REQUEST_THRESHOLD_MS', '1000')
    vi.stubEnv('API_PERFORMANCE_WINDOW_MINUTES', '15')
    vi.stubEnv('API_PERFORMANCE_MAX_SAMPLES', '100')
  })

  it('calculates percentiles and ranks normalized routes', async () => {
    const collector = await import('./http-performance.js')
    collector.clearHttpPerformanceSamples()
    for (const durationMs of [10, 20, 30, 40, 2000]) {
      collector.recordHttpPerformance({ method: 'GET', route: '/api/v1/hosts/:id', statusCode: 200, durationMs, requestId: `req-${durationMs}` })
    }
    collector.recordHttpPerformance({ method: 'POST', route: '/api/v1/reports', statusCode: 500, durationMs: 1500, requestId: 'req-error' })

    const snapshot = collector.getHttpPerformanceSnapshot()
    expect(snapshot).toMatchObject({ sampleCount: 6, errorCount: 1, slowRequestCount: 2, p50Ms: 30, p95Ms: 2000 })
    expect(snapshot.topRoutes[0]).toMatchObject({ method: 'GET', route: '/api/v1/hosts/:id', requests: 5, p95Ms: 2000 })
    expect(snapshot.recentSlowRequests.map(item => item.requestId)).toEqual(['req-error', 'req-2000'])
  })

  it('uses nearest-rank percentiles without averaging away a latency spike', async () => {
    const { percentile } = await import('./http-performance.js')
    expect(percentile([10, 20, 30, 1000], 95)).toBe(1000)
    expect(percentile([], 95)).toBeNull()
  })

  it('bounds memory and discards samples outside the configured window', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-24T12:00:00.000Z'))
      const collector = await import('./http-performance.js')
      collector.clearHttpPerformanceSamples()
      collector.recordHttpPerformance({ method: 'GET', route: '/api/v1/old', statusCode: 200, durationMs: 10, requestId: 'req-old' })

      vi.setSystemTime(new Date('2026-08-24T12:16:00.000Z'))
      for (let index = 0; index < 120; index += 1) {
        collector.recordHttpPerformance({ method: 'GET', route: '/api/v1/current', statusCode: 200, durationMs: index, requestId: `req-${index}` })
      }

      const snapshot = collector.getHttpPerformanceSnapshot()
      expect(snapshot.sampleCount).toBe(100)
      expect(snapshot.topRoutes).toHaveLength(1)
      expect(snapshot.topRoutes[0]).toMatchObject({ route: '/api/v1/current', requests: 100 })
    } finally {
      vi.useRealTimers()
    }
  })
})
