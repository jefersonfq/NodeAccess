import { sftpService } from './sftp.service'
import type { TerminalCompletion } from './terminal-autocomplete.service'

const cache = new Map<string, { expiresAt: number; entries: Array<{ name: string; type: string }> }>()
const pending = new Map<string, Promise<Array<{ name: string; type: string }>>>()
const TTL_MS = 5_000
const ERROR_TTL_MS = 1_000
const MAX_CACHE_ENTRIES = 64
const PATH_COMMANDS = new Set(['cd', 'ls', 'cat', 'less', 'more', 'tail', 'head', 'vim', 'vi', 'nano', 'stat', 'du', 'find'])
const metrics = { requests: 0, cacheHits: 0, cacheMisses: 0, errors: 0, aborted: 0, evictions: 0 }

export async function suggestRemotePaths(input: { tenantId: number; hostId: number; sessionId: number | null; line: string; signal?: AbortSignal }): Promise<TerminalCompletion[]> {
  const parsed = parsePathQuery(input.line)
  if (!parsed) return []
  const key = `${input.tenantId}:${input.hostId}:${input.sessionId ?? 'none'}:${parsed.directory}`
  let cached = cache.get(key)
  if (cached?.expiresAt && cached.expiresAt > Date.now()) {
    metrics.cacheHits += 1
    cache.delete(key)
    cache.set(key, cached)
  }
  if (!cached || cached.expiresAt <= Date.now()) {
    metrics.cacheMisses += 1
    let request = input.signal ? undefined : pending.get(key)
    if (!request) {
      metrics.requests += 1
      request = sftpService.list(input.hostId, parsed.directory, { signal: input.signal })
        .then((response) => response.data.entries.map((entry) => ({ name: entry.name, type: entry.type })))
        .catch(() => {
          if (input.signal?.aborted) {
            metrics.aborted += 1
            return []
          }
          metrics.errors += 1
          setCache(key, { expiresAt: Date.now() + ERROR_TTL_MS, entries: [] })
          return []
        })
        .finally(() => { if (!input.signal) pending.delete(key) })
      if (!input.signal) pending.set(key, request)
    }
    const entries = await request
    if (input.signal?.aborted) return []
    const negativeCache = cache.get(key)
    cached = negativeCache && negativeCache.expiresAt > Date.now()
      ? negativeCache
      : { expiresAt: Date.now() + TTL_MS, entries }
    setCache(key, cached)
  }
  return cached.entries
    .filter((entry) => entry.name.toLowerCase().startsWith(parsed.namePrefix.toLowerCase()))
    .sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((entry) => ({
      value: `${parsed.linePrefix}${parsed.displayDirectory}${escapeShellPathSegment(entry.name)}${entry.type === 'directory' ? '/' : ''}`,
      descriptionKey: entry.type === 'directory' ? 'terminal.autocomplete.descriptions.cd' : 'terminal.autocomplete.descriptions.vim',
      source: 'path',
    }))
}

function setCache(key: string, value: { expiresAt: number; entries: Array<{ name: string; type: string }> }) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) break
    cache.delete(oldest)
    metrics.evictions += 1
  }
}

function escapeShellPathSegment(value: string) {
  return value.replace(/[\r\n\0]/g, '').replace(/([\s\\"'`$&;|<>()[\]{}!*?])/g, '\\$1')
}

export function canSuggestRemotePaths(line: string) { return parsePathQuery(line) !== null }

export function clearRemotePathAutocomplete(scope?: { tenantId: number; hostId: number; sessionId: number | null }) {
  if (!scope) cache.clear()
  else {
    const prefix = `${scope.tenantId}:${scope.hostId}:${scope.sessionId ?? 'none'}:`
    for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
  }
  pending.clear()
}

export function remotePathAutocompleteMetrics() { return { ...metrics, cacheSize: cache.size, pending: pending.size } }

export function resetRemotePathAutocompleteMetrics() {
  metrics.requests = 0; metrics.cacheHits = 0; metrics.cacheMisses = 0; metrics.errors = 0; metrics.aborted = 0; metrics.evictions = 0
}

function parsePathQuery(line: string) {
  const match = line.match(/^(\s*)(\S+)(\s+)([^\s]*)$/)
  if (!match || !PATH_COMMANDS.has(match[2]!)) return null
  const token = match[4]!
  const slash = token.lastIndexOf('/')
  const displayDirectory = slash >= 0 ? token.slice(0, slash + 1) : ''
  return {
    directory: displayDirectory || '.',
    displayDirectory,
    namePrefix: slash >= 0 ? token.slice(slash + 1) : token,
    linePrefix: `${match[1]}${match[2]}${match[3]}`,
  }
}
