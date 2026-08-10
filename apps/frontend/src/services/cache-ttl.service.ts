type CacheTtlPreset = 'live' | 'hot' | 'warm' | 'cold'

const durationPattern = /^(\d+)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i

function parseDuration(input: string, fallbackMs: number): number {
  const normalized = input.trim().toLowerCase()
  const match = normalized.match(durationPattern)
  if (!match) return fallbackMs

  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return fallbackMs

  const unit = match[2]
  if (unit === 'ms') return amount
  if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'second' || unit === 'seconds') return amount * 1_000
  if (unit === 'm' || unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') return amount * 60_000
  if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') return amount * 3_600_000

  return fallbackMs
}

function resolveEnvDuration(key: string, fallback: string): number {
  return parseDuration(import.meta.env[key] ?? fallback, parseDuration(fallback, 30_000))
}

const presets = {
  live: resolveEnvDuration('VITE_CACHE_TTL_LIVE', '15s'),
  hot: resolveEnvDuration('VITE_CACHE_TTL_HOT', '90s'),
  warm: resolveEnvDuration('VITE_CACHE_TTL_WARM', '5m'),
  cold: resolveEnvDuration('VITE_CACHE_TTL_COLD', '1h'),
} as const

export function cacheTtl(preset: CacheTtlPreset): number {
  return presets[preset]
}

export const cacheTtls = {
  features: cacheTtl('warm'),
  settings: cacheTtl('warm'),
  groupsList: cacheTtl('warm'),
  foldersList: cacheTtl('warm'),
  tagsList: cacheTtl('warm'),
  bastionsList: cacheTtl('warm'),
  pemKeysList: cacheTtl('warm'),
  integrationsList: cacheTtl('warm'),
  integrationsGoogle: cacheTtl('warm'),
  integrationsLdap: cacheTtl('warm'),
  integrationsOidc: cacheTtl('warm'),
  tenantAuthPolicy: cacheTtl('warm'),
  integrationsOpenAi: cacheTtl('hot'),
  integrationsLocalAi: cacheTtl('hot'),
  integrationsJira: cacheTtl('hot'),
  hostsList: cacheTtl('hot'),
  hostsDetail: cacheTtl('hot'),
  hostsSidebarSummary: cacheTtl('hot'),
  hostsSidebarBootstrap: cacheTtl('hot'),
  hostsByIds: cacheTtl('hot'),
  inventoryList: cacheTtl('hot'),
  snippetsList: cacheTtl('hot'),
  snippetGroupsList: cacheTtl('hot'),
  userPreferences: cacheTtl('warm'),
  agentsList: cacheTtl('warm'),
  agentsStatus: cacheTtl('live'),
  agentsDownloads: cacheTtl('cold'),
  forwardingsList: cacheTtl('hot'),
} as const
