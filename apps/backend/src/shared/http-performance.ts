import { env } from '../config/env.js'
import { metrics } from './metrics.js'

export interface HttpPerformanceSample {
  timestamp: string
  method: string
  route: string
  statusCode: number
  durationMs: number
  requestId: string
}

export interface HttpRoutePerformance {
  method: string
  route: string
  requests: number
  errors: number
  p95Ms: number
  p99Ms: number
  maxMs: number
}

export interface HttpPerformanceSnapshot {
  windowMinutes: number
  sampleCount: number
  errorCount: number
  errorRatePercent: number
  p50Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
  maxMs: number | null
  slowRequestThresholdMs: number
  slowRequestCount: number
  topRoutes: HttpRoutePerformance[]
  recentSlowRequests: HttpPerformanceSample[]
  resetAt: string
  note: string
}

const samples: HttpPerformanceSample[] = []
let resetAt = new Date().toISOString()

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}

export function percentile(values: number[], target: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.ceil((target / 100) * sorted.length) - 1)
  return rounded(sorted[index] ?? sorted.at(-1) ?? 0)
}

function prune(nowMs: number): void {
  const cutoff = nowMs - env.API_PERFORMANCE_WINDOW_MINUTES * 60_000
  while (samples.length && Date.parse(samples[0]!.timestamp) < cutoff) samples.shift()
  if (samples.length > env.API_PERFORMANCE_MAX_SAMPLES) {
    samples.splice(0, samples.length - env.API_PERFORMANCE_MAX_SAMPLES)
  }
}

function statusClass(statusCode: number): string {
  return `${Math.floor(statusCode / 100)}xx`
}

export function recordHttpPerformance(input: Omit<HttpPerformanceSample, 'timestamp'> & { timestamp?: string }): HttpPerformanceSample {
  const sample: HttpPerformanceSample = {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
    durationMs: rounded(Math.max(0, input.durationMs)),
  }
  samples.push(sample)
  prune(Date.parse(sample.timestamp))
  const labels = {
    method: sample.method,
    route: sample.route,
    status_class: statusClass(sample.statusCode),
    app_mode: env.APP_MODE,
  }
  metrics.inc('nodeaccess_http_requests_total', 'HTTP requests completed by normalized route', labels)
  metrics.observe(
    'nodeaccess_http_request_duration_ms',
    'HTTP request duration in milliseconds by normalized route',
    [25, 50, 100, 250, 500, 750, 1000, 2500, 5000, 10000, 30000],
    sample.durationMs,
    labels,
  )
  if (sample.statusCode >= 500) {
    metrics.inc('nodeaccess_http_errors_total', 'HTTP server errors by normalized route', labels)
  }
  return sample
}

export function getHttpPerformanceSnapshot(now = new Date()): HttpPerformanceSnapshot {
  prune(now.getTime())
  const durations = samples.map(sample => sample.durationMs)
  const errors = samples.filter(sample => sample.statusCode >= 500)
  const slow = samples.filter(sample => sample.durationMs >= env.SLOW_REQUEST_THRESHOLD_MS)
  const byRoute = new Map<string, HttpPerformanceSample[]>()
  for (const sample of samples) {
    const key = `${sample.method} ${sample.route}`
    byRoute.set(key, [...(byRoute.get(key) ?? []), sample])
  }
  const topRoutes = [...byRoute.values()].map((routeSamples): HttpRoutePerformance => {
    const routeDurations = routeSamples.map(sample => sample.durationMs)
    const first = routeSamples[0]!
    return {
      method: first.method,
      route: first.route,
      requests: routeSamples.length,
      errors: routeSamples.filter(sample => sample.statusCode >= 500).length,
      p95Ms: percentile(routeDurations, 95) ?? 0,
      p99Ms: percentile(routeDurations, 99) ?? 0,
      maxMs: rounded(Math.max(...routeDurations)),
    }
  }).sort((a, b) => b.p95Ms - a.p95Ms || b.maxMs - a.maxMs).slice(0, 10)

  return {
    windowMinutes: env.API_PERFORMANCE_WINDOW_MINUTES,
    sampleCount: samples.length,
    errorCount: errors.length,
    errorRatePercent: samples.length ? rounded((errors.length / samples.length) * 100) : 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: durations.length ? rounded(Math.max(...durations)) : null,
    slowRequestThresholdMs: env.SLOW_REQUEST_THRESHOLD_MS,
    slowRequestCount: slow.length,
    topRoutes,
    recentSlowRequests: slow.slice(-20).reverse(),
    resetAt,
    note: 'Amostras locais em memoria; reiniciam com o processo. Use Prometheus para historico persistente e HA.',
  }
}

export function clearHttpPerformanceSamples(): void {
  samples.splice(0)
  resetAt = new Date().toISOString()
}
