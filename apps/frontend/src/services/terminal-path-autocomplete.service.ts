import { sftpService } from './sftp.service'
import { hasTerminalSftpChannel, listViaTerminalSftp } from './terminal-sftp-channel.service'
import type { TerminalCompletion } from './terminal-autocomplete.service'

type RemoteEntry = { name: string; type: string; permissions?: string }
type CachedDirectory = { expiresAt: number; entries: RemoteEntry[]; failed: boolean }
export type RemoteAutocompleteState = 'ready' | 'empty' | 'error'
export interface RemotePathAutocompleteResult { items: TerminalCompletion[]; state: RemoteAutocompleteState; directory: string | null }

const cache = new Map<string, CachedDirectory>()
const pending = new Map<string, Promise<CachedDirectory>>()
const TTL_MS = 8_000
const ERROR_TTL_MS = 1_000
const MAX_CACHE_ENTRIES = 96
const MAX_VISIBLE_ITEMS = 8
const PATH_COMMANDS = new Set(['cd', 'ls', 'cat', 'less', 'more', 'tail', 'head', 'vim', 'vi', 'nano', 'stat', 'du', 'find', 'mkdir', 'rmdir', 'rm', 'mv', 'cp', 'touch', 'chmod', 'chown', 'ln', 'tar', 'file', 'readlink', 'realpath', 'source', '.', 'wc', 'diff', 'rsync'])
const DIRECTORY_ONLY_COMMANDS = new Set(['cd', 'find', 'mkdir', 'rmdir'])
const metrics = { requests: 0, cacheHits: 0, cacheMisses: 0, errors: 0, aborted: 0, evictions: 0, exactDirectoryExpansions: 0 }

export async function suggestRemotePaths(input: { tenantId: number; hostId: number; sessionId: number | null; line: string; currentDirectory?: string | null; signal?: AbortSignal }): Promise<TerminalCompletion[]> {
  return (await suggestRemotePathsDetailed(input)).items
}

export async function suggestRemotePathsDetailed(input: { tenantId: number; hostId: number; sessionId: number | null; line: string; currentDirectory?: string | null; signal?: AbortSignal }): Promise<RemotePathAutocompleteResult> {
  const parsed = parsePathQuery(input.line, input.currentDirectory)
  if (!parsed) return { items: [], state: 'empty', directory: null }
  const parent = await loadDirectory(input, parsed.directory, parsed.namePrefix, parsed.directoryOnly)
  if (input.signal?.aborted) return { items: [], state: 'empty', directory: parsed.directory }
  if (parent.failed) return { items: [], state: 'error', directory: parsed.directory }

  const matches = filterEntries(parent.entries, parsed.namePrefix, parsed.directoryOnly)
  const exactDirectory = parsed.expandExactDirectory
    ? matches.find((entry) => entry.type === 'directory' && entry.name.toLowerCase() === parsed.namePrefix.toLowerCase())
    : undefined
  if (exactDirectory) {
    const childDirectory = joinRemotePath(parsed.directory, exactDirectory.name)
    const children = await loadDirectory(input, childDirectory, '', parsed.directoryOnly)
    if (!children.failed && !input.signal?.aborted) {
      metrics.exactDirectoryExpansions += 1
      const items = toCompletions(children.entries, { ...parsed, directory: childDirectory, namePrefix: '', displayDirectory: ensureTrailingSlash(parsed.typedPath) })
      return { items, state: items.length ? 'ready' : 'empty', directory: childDirectory }
    }
  }

  const items = toCompletions(matches, parsed)
  return { items, state: items.length ? 'ready' : 'empty', directory: parsed.directory }
}

async function loadDirectory(input: { tenantId: number; hostId: number; sessionId: number | null; signal?: AbortSignal }, directory: string, prefix = '', directoriesOnly = false): Promise<CachedDirectory> {
  const normalizedPrefix = unescapeShellToken(prefix).toLowerCase()
  const useSessionChannel = !!input.sessionId && hasTerminalSftpChannel(input.sessionId)
  const queryVariant = useSessionChannel ? `:${directoriesOnly ? 'd' : 'a'}:${normalizedPrefix}` : ':full'
  const key = `${input.tenantId}:${input.hostId}:${input.sessionId ?? 'none'}:${directory}${queryVariant}`
  let cached = cache.get(key)
  if (cached?.expiresAt && cached.expiresAt > Date.now()) {
    metrics.cacheHits += 1
    cache.delete(key); cache.set(key, cached)
    return cached
  }
  metrics.cacheMisses += 1
  let request = input.signal ? undefined : pending.get(key)
  if (!request) {
    metrics.requests += 1
    const listing = input.sessionId && useSessionChannel
      ? listViaTerminalSftp(input.sessionId, directory, input.signal, { prefix: normalizedPrefix, directoriesOnly, limit: 96 })
      : sftpService.list(input.hostId, directory, { signal: input.signal }).then((response) => response.data)
    request = listing
      .then((response) => ({ expiresAt: Date.now() + TTL_MS, entries: response.entries.map((entry) => ({ name: entry.name, type: entry.type, permissions: 'permissions' in entry ? String(entry.permissions ?? '') : undefined })), failed: false }))
      .catch(() => {
        if (input.signal?.aborted) { metrics.aborted += 1; return { expiresAt: 0, entries: [], failed: false } }
        metrics.errors += 1
        return { expiresAt: Date.now() + ERROR_TTL_MS, entries: [], failed: true }
      })
      .then((value) => { if (value.expiresAt) setCache(key, value); return value })
      .finally(() => { if (!input.signal) pending.delete(key) })
    if (!input.signal) pending.set(key, request)
  }
  return request
}

function filterEntries(entries: RemoteEntry[], prefix: string, directoryOnly: boolean) {
  const normalized = unescapeShellToken(prefix).toLowerCase()
  return entries.filter((entry) => (!directoryOnly || entry.type === 'directory') && entry.name.toLowerCase().startsWith(normalized))
}

function toCompletions(entries: RemoteEntry[], parsed: ParsedPathQuery): TerminalCompletion[] {
  return [...entries]
    .filter((entry) => !parsed.directoryOnly || entry.type === 'directory')
    .sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name))
    .slice(0, MAX_VISIBLE_ITEMS)
    .map((entry) => ({
      value: `${parsed.linePrefix}${safeDisplayDirectory(parsed.displayDirectory, entry.name)}${escapeShellPathSegment(entry.name)}${entry.type === 'directory' ? '/' : ''}`,
      descriptionKey: entry.type === 'directory' ? 'terminal.autocomplete.descriptions.directory' : 'terminal.autocomplete.descriptions.file',
      source: 'path' as const,
      resourceType: entry.type === 'directory' ? 'directory' as const : entry.type === 'symlink' ? 'symlink' as const : 'file' as const,
      contextLabel: parsed.directory,
      metadataLabel: entry.permissions?.replace(/^[dl-]/, '').slice(0, 10) || undefined,
    }))
}

// A relative filename beginning with "-" would otherwise be interpreted as a
// command option. Prefixing only this case with ./ keeps the suggestion literal.
function safeDisplayDirectory(displayDirectory: string, entryName: string) {
  return !displayDirectory && entryName.startsWith('-') ? './' : displayDirectory
}

function setCache(key: string, value: CachedDirectory) {
  cache.delete(key); cache.set(key, value)
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) break
    cache.delete(oldest); metrics.evictions += 1
  }
}

function escapeShellPathSegment(value: string) { return value.replace(/[\r\n\0]/g, '').replace(/([\s\\"'`$&;|<>()[\]{}!*?])/g, '\\$1') }
function unescapeShellToken(value: string) { return value.replace(/^['"]|['"]$/g, '').replace(/\\(.)/g, '$1') }
function ensureTrailingSlash(value: string) { return value.endsWith('/') ? value : `${value}/` }
function joinRemotePath(parent: string, child: string) { return parent === '/' ? `/${child}` : `${parent.replace(/\/$/, '')}/${child}` }

export function canSuggestRemotePaths(line: string) { return parsePathQuery(line, null) !== null }
export function clearRemotePathAutocomplete(scope?: { tenantId: number; hostId: number; sessionId: number | null }) {
  if (!scope) cache.clear()
  else { const prefix = `${scope.tenantId}:${scope.hostId}:${scope.sessionId ?? 'none'}:`; for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key) }
  pending.clear()
}
export function remotePathAutocompleteMetrics() { return { ...metrics, cacheSize: cache.size, pending: pending.size } }
export function resetRemotePathAutocompleteMetrics() { for (const key of Object.keys(metrics) as Array<keyof typeof metrics>) metrics[key] = 0 }

interface ParsedPathQuery { command: string; directory: string; displayDirectory: string; namePrefix: string; linePrefix: string; typedPath: string; directoryOnly: boolean; expandExactDirectory: boolean }

function parsePathQuery(line: string, currentDirectory: string | null | undefined): ParsedPathQuery | null {
  const segmentStart = findLastCommandSegmentStart(line)
  const segment = line.slice(segmentStart)
  const tokens = tokenizeShellSegment(segment)
  if (!tokens.length) return null
  const commandIndex = findCommandIndex(tokens)
  const commandToken = tokens[commandIndex]
  if (!commandToken || !PATH_COMMANDS.has(commandToken.value)) return null
  const active = tokens.at(-1)!
  if (active === commandToken || (active.value.startsWith('-') && !active.value.startsWith('./') && !active.value.startsWith('../'))) return null
  const typedPath = unescapeShellToken(active.value)
  const slash = typedPath.lastIndexOf('/')
  const typedDirectory = slash >= 0 ? typedPath.slice(0, slash + 1) : ''
  const directory = resolveLookupDirectory(typedDirectory, currentDirectory)
  return {
    command: commandToken.value,
    directory,
    displayDirectory: typedDirectory,
    namePrefix: slash >= 0 ? typedPath.slice(slash + 1) : typedPath,
    linePrefix: line.slice(0, segmentStart + active.start),
    typedPath,
    directoryOnly: DIRECTORY_ONLY_COMMANDS.has(commandToken.value),
    expandExactDirectory: commandToken.value === 'cd' && typedPath.length > 0 && !typedPath.endsWith('/'),
  }
}

function findCommandIndex(tokens: Array<{ value: string; start: number }>) {
  let index = 0
  if (tokens[index]?.value === 'sudo') {
    index += 1
    const optionsWithValue = new Set(['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from', '-T', '--command-timeout', '-R', '--chroot', '-D', '--chdir'])
    while (tokens[index]?.value.startsWith('-')) {
      const option = tokens[index]!.value.split('=')[0]!
      index += 1
      if (optionsWithValue.has(option) && !tokens[index - 1]!.value.includes('=')) index += 1
    }
  }
  if (tokens[index]?.value === 'env') {
    index += 1
    while (tokens[index]?.value.startsWith('-')) index += 1
  }
  while (tokens[index] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!.value)) index += 1
  return index
}

function resolveLookupDirectory(typedDirectory: string, currentDirectory?: string | null) {
  if (!typedDirectory) return currentDirectory || '.'
  if (typedDirectory.startsWith('/')) return normalizeRemotePath(typedDirectory)
  if (typedDirectory === '~/') return '.'
  return currentDirectory ? normalizeRemotePath(`${currentDirectory}/${typedDirectory}`) : typedDirectory
}
function normalizeRemotePath(value: string) {
  const absolute = value.startsWith('/'), output: string[] = []
  for (const part of value.split('/')) { if (!part || part === '.') continue; if (part === '..') output.pop(); else output.push(part) }
  return `${absolute ? '/' : ''}${output.join('/')}` || (absolute ? '/' : '.')
}
function findLastCommandSegmentStart(line: string) {
  let quote = '', escaped = false, start = 0
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === ';' || char === '|' || (char === '&' && line[index + 1] === '&')) { start = index + (line[index + 1] === char ? 2 : 1); index = start - 1 }
  }
  return start
}
function tokenizeShellSegment(segment: string) {
  const tokens: Array<{ value: string; start: number }> = []
  let value = '', start = -1, quote = '', escaped = false
  const push = () => { if (start >= 0) tokens.push({ value, start }); value = ''; start = -1 }
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index]!
    if (start < 0 && !/\s/.test(char)) start = index
    if (escaped) { value += `\\${char}`; escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (quote) { value += char; if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; value += char; continue }
    if (/\s/.test(char)) { push(); continue }
    value += char
  }
  if (escaped) value += '\\'
  push()
  if (/\s$/.test(segment)) tokens.push({ value: '', start: segment.length })
  return tokens
}
