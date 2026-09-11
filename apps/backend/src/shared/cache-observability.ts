import { DURATION_MS_BUCKETS, metrics } from './metrics.js'

export type BackendCacheDomain = 'host_dashboard' | 'user_dashboard' | 'host_sidebar'
export type BackendCacheOperation = 'read' | 'write' | 'invalidate'
export type BackendCacheResult = 'hit' | 'miss' | 'success' | 'error' | 'disabled'

type MutableCacheStats = {
  hits: number
  misses: number
  writes: number
  invalidations: number
  errors: number
  disabled: number
  totalDurationMs: number
  operations: number
  lastActivityAt: string | null
}

export type BackendCacheStats = MutableCacheStats & {
  domain: BackendCacheDomain
  hitRate: number | null
  averageDurationMs: number | null
}

const domains: BackendCacheDomain[] = ['host_dashboard', 'user_dashboard', 'host_sidebar']
const stats = new Map<BackendCacheDomain, MutableCacheStats>()

function state(domain: BackendCacheDomain): MutableCacheStats {
  const current = stats.get(domain)
  if (current) return current
  const created: MutableCacheStats = {
    hits: 0,
    misses: 0,
    writes: 0,
    invalidations: 0,
    errors: 0,
    disabled: 0,
    totalDurationMs: 0,
    operations: 0,
    lastActivityAt: null,
  }
  stats.set(domain, created)
  return created
}

export function recordBackendCacheOperation(
  domain: BackendCacheDomain,
  operation: BackendCacheOperation,
  result: BackendCacheResult,
  durationMs = 0,
): void {
  const current = state(domain)
  if (result === 'hit') current.hits += 1
  if (result === 'miss') current.misses += 1
  if (operation === 'write' && result === 'success') current.writes += 1
  if (operation === 'invalidate' && result === 'success') current.invalidations += 1
  if (result === 'error') current.errors += 1
  if (result === 'disabled') current.disabled += 1
  current.operations += 1
  current.totalDurationMs += Math.max(0, durationMs)
  current.lastActivityAt = new Date().toISOString()

  const labels = { domain, operation, result }
  metrics.inc('nodeaccess_cache_operations_total', 'Backend cache operations by domain and result', labels)
  metrics.observe('nodeaccess_cache_operation_duration_ms', 'Backend cache operation duration in milliseconds', DURATION_MS_BUCKETS, Math.max(0, durationMs), labels)
}

export function getBackendCacheStats(): BackendCacheStats[] {
  return domains.map((domain) => {
    const current = state(domain)
    const reads = current.hits + current.misses
    return {
      domain,
      ...current,
      hitRate: reads > 0 ? current.hits / reads : null,
      averageDurationMs: current.operations > 0 ? current.totalDurationMs / current.operations : null,
    }
  })
}

export function resetBackendCacheStats(): void {
  stats.clear()
}
