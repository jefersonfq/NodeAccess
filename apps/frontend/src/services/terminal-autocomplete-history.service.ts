const MAX_ITEMS = 24
const preferences = new Map<string, boolean>()
const fallback = new Map<string, HistoryEntry[]>()
const PREFIX = 'na:terminal-autocomplete-history:'
const SECRET_PATTERN = /(?:password|passwd|token|secret|api[_-]?key|authorization|bearer)\s*[=:]|--(?:password|token|secret|api[_-]?key)\s+\S+|:\/\/[^\s/:]+:[^\s/@]+@/i
type HistoryEntry = { value: string; count: number; lastUsed: number }

export function readTerminalAutocompleteHistory(scope: { userId: number; tenantId: number; hostId: number }): string[] {
  try {
    if (!terminalAutocompleteHistoryEnabled(scope)) return []
    return readEntries(scope).sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed).slice(0, MAX_ITEMS).map((entry) => entry.value)
  } catch { return [] }
}

export function recordTerminalAutocompleteHistory(scope: { userId: number; tenantId: number; hostId: number }, value: string) {
  if (!terminalAutocompleteHistoryEnabled(scope)) return false
  if (!isSafeHistoryValue(value)) return false
  const normalized = value.trim()
  if (!isSafeHistoryValue(normalized)) return false
  const entries = readEntries(scope), existing = entries.find((entry) => entry.value === normalized)
  const now = Math.max(Date.now(), ...entries.map((entry) => entry.lastUsed + 1), 1)
  if (existing) { existing.count += 1; existing.lastUsed = now }
  else entries.push({ value: normalized, count: 1, lastUsed: now })
  const next = entries.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_ITEMS)
  try { localStorage.setItem(key(scope), JSON.stringify(next)); fallback.delete(key(scope)) }
  catch { rememberFallback(key(scope), next) }
  return true
}

export function clearTerminalAutocompleteHistory(scope: { userId: number; tenantId: number; hostId: number }) {
  try { localStorage.removeItem(key(scope)); fallback.delete(key(scope)) }
  catch { rememberFallback(key(scope), []) }
}

export function isSafeHistoryValue(value: string) {
  return value.length > 0 && value.length <= 256 && !SECRET_PATTERN.test(value) && !/[\x00-\x1f\x7f]/.test(value)
}

function key(scope: { userId: number; tenantId: number; hostId: number }) {
  return `${PREFIX}${scope.userId}:${scope.tenantId}:${scope.hostId}`
}

function readEntries(scope: { userId: number; tenantId: number; hostId: number }): HistoryEntry[] {
  const memory = fallback.get(key(scope))
  if (memory) return memory.map(entry => ({ ...entry }))
  let parsed: unknown
  try { parsed = JSON.parse(localStorage.getItem(key(scope)) ?? '[]') }
  catch { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item, index): HistoryEntry[] => {
    if (typeof item === 'string' && isSafeHistoryValue(item)) return [{ value: item, count: 1, lastUsed: parsed.length - index }]
    if (item && typeof item === 'object') {
      const candidate = item as Partial<HistoryEntry>
      if (typeof candidate.value === 'string' && isSafeHistoryValue(candidate.value)) return [{ value: candidate.value, count: Math.max(1, Number(candidate.count) || 1), lastUsed: Number(candidate.lastUsed) || 0 }]
    }
    return []
  })
}

function rememberFallback(scopeKey: string, entries: HistoryEntry[]) {
  fallback.delete(scopeKey); fallback.set(scopeKey, entries)
  while (fallback.size > 96) fallback.delete(fallback.keys().next().value!)
}

export function terminalAutocompleteHistoryEnabled(scope: { userId: number; tenantId: number; hostId: number }) {
  const preferenceKey = `${key(scope)}:enabled`
  if (preferences.has(preferenceKey)) return preferences.get(preferenceKey)!
  try { return localStorage.getItem(preferenceKey) !== 'false' } catch { return true }
}

export function setTerminalAutocompleteHistoryEnabled(scope: { userId: number; tenantId: number; hostId: number }, enabled: boolean) {
  const preferenceKey = `${key(scope)}:enabled`
  try { localStorage.setItem(preferenceKey, String(enabled)); preferences.delete(preferenceKey) }
  catch {
    preferences.set(preferenceKey, enabled)
    while (preferences.size > 96) preferences.delete(preferences.keys().next().value!)
  }
}
