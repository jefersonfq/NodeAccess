type Labels = Record<string, string | number | boolean | null | undefined>

interface MetricSeries {
  help: string
  type: 'counter' | 'gauge'
  values: Map<string, { labels: Record<string, string>; value: number }>
}

interface HistogramSeries {
  help: string
  buckets: number[]
  values: Map<string, {
    labels: Record<string, string>
    buckets: number[]
    count: number
    sum: number
  }>
}

function normalizeLabels(labels: Labels = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([, value]) => value !== null && value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value)]),
  )
}

function labelsKey(labels: Record<string, string>): string {
  return JSON.stringify(labels)
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels)
  if (entries.length === 0) return ''
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',')}}`
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

function escapeHelp(value: string): string {
  return value.replace(/\n/g, ' ')
}

class MetricsRegistry {
  private metrics = new Map<string, MetricSeries>()
  private histograms = new Map<string, HistogramSeries>()

  inc(name: string, help: string, labels: Labels = {}, value = 1): void {
    const series = this.getMetric(name, help, 'counter')
    const normalized = normalizeLabels(labels)
    const key = labelsKey(normalized)
    const current = series.values.get(key) ?? { labels: normalized, value: 0 }
    current.value += value
    series.values.set(key, current)
  }

  addGauge(name: string, help: string, labels: Labels = {}, value: number): void {
    const series = this.getMetric(name, help, 'gauge')
    const normalized = normalizeLabels(labels)
    const key = labelsKey(normalized)
    const current = series.values.get(key) ?? { labels: normalized, value: 0 }
    current.value += value
    series.values.set(key, current)
  }

  setGauge(name: string, help: string, labels: Labels = {}, value: number): void {
    const series = this.getMetric(name, help, 'gauge')
    const normalized = normalizeLabels(labels)
    series.values.set(labelsKey(normalized), { labels: normalized, value })
  }

  observe(name: string, help: string, buckets: number[], value: number, labels: Labels = {}): void {
    const series = this.getHistogram(name, help, buckets)
    const normalized = normalizeLabels(labels)
    const key = labelsKey(normalized)
    const current = series.values.get(key) ?? {
      labels: normalized,
      buckets: new Array(series.buckets.length).fill(0) as number[],
      count: 0,
      sum: 0,
    }

    series.buckets.forEach((bucket, index) => {
      if (value <= bucket) current.buckets[index] += 1
    })
    current.count += 1
    current.sum += value
    series.values.set(key, current)
  }

  render(): string {
    const lines: string[] = []

    for (const [name, series] of [...this.metrics.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`# HELP ${name} ${escapeHelp(series.help)}`)
      lines.push(`# TYPE ${name} ${series.type}`)
      for (const item of [...series.values.values()].sort((a, b) => labelsKey(a.labels).localeCompare(labelsKey(b.labels)))) {
        lines.push(`${name}${formatLabels(item.labels)} ${item.value}`)
      }
    }

    for (const [name, series] of [...this.histograms.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`# HELP ${name} ${escapeHelp(series.help)}`)
      lines.push(`# TYPE ${name} histogram`)
      for (const item of [...series.values.values()].sort((a, b) => labelsKey(a.labels).localeCompare(labelsKey(b.labels)))) {
        series.buckets.forEach((bucket, index) => {
          lines.push(`${name}_bucket${formatLabels({ ...item.labels, le: String(bucket) })} ${item.buckets[index]}`)
        })
        lines.push(`${name}_bucket${formatLabels({ ...item.labels, le: '+Inf' })} ${item.count}`)
        lines.push(`${name}_sum${formatLabels(item.labels)} ${item.sum}`)
        lines.push(`${name}_count${formatLabels(item.labels)} ${item.count}`)
      }
    }

    return `${lines.join('\n')}\n`
  }

  private getMetric(name: string, help: string, type: 'counter' | 'gauge'): MetricSeries {
    const existing = this.metrics.get(name)
    if (existing) return existing
    const created: MetricSeries = { help, type, values: new Map() }
    this.metrics.set(name, created)
    return created
  }

  private getHistogram(name: string, help: string, buckets: number[]): HistogramSeries {
    const existing = this.histograms.get(name)
    if (existing) return existing
    const created: HistogramSeries = { help, buckets: [...buckets].sort((a, b) => a - b), values: new Map() }
    this.histograms.set(name, created)
    return created
  }
}

export const metrics = new MetricsRegistry()

export const DURATION_MS_BUCKETS = [50, 100, 250, 500, 750, 1000, 2500, 5000, 10000, 30000]
export const BYTES_BUCKETS = [512, 1024, 4096, 16384, 65536, 131072, 524288, 1048576, 5242880, 10485760]
