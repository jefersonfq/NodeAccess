const MAX_ITEMS = 24
const PREFIX = 'na:terminal-autocomplete-history:'
const SECRET_PATTERN = /(?:password|passwd|token|secret|api[_-]?key|authorization|bearer)\s*[=:]|--(?:password|token|secret|api[_-]?key)\s+\S+|:\/\/[^\s/:]+:[^\s/@]+@/i
type HistoryEntry = { value: string; count: number; lastUsed: number }

export function readTerminalAutocompleteHistory(scope: { userId: number; tenantId: number; hostId: number }): string[] {
  try {
    return readEntries(scope).sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed).slice(0, MAX_ITEMS).map((entry) => entry.value)
  } catch { return [] }
}

export function recordTerminalAutocompleteHistory(scope: { userId: number; tenantId: number; hostId: number }, value: string) {
  const normalized = value.trim()
  if (!isSafeHistoryValue(normalized)) return false
  const entries = readEntries(scope), existing = entries.find((entry) => entry.value === normalized)
  const now = Math.max(Date.now(), ...entries.map((entry) => entry.lastUsed + 1), 1)
  if (existing) { existing.count += 1; existing.lastUsed = now }
  else entries.push({ value: normalized, count: 1, lastUsed: now })
  const next = entries.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_ITEMS)
  localStorage.setItem(key(scope), JSON.stringify(next))
  return true
}

export function clearTerminalAutocompleteHistory(scope: { userId: number; tenantId: number; hostId: number }) {
  localStorage.removeItem(key(scope))
}

export function isSafeHistoryValue(value: string) {
  return value.length > 0 && value.length <= 256 && !SECRET_PATTERN.test(value) && !/[\r\n\0]/.test(value)
}

function key(scope: { userId: number; tenantId: number; hostId: number }) {
  return `${PREFIX}${scope.userId}:${scope.tenantId}:${scope.hostId}`
}

function readEntries(scope: { userId: number; tenantId: number; hostId: number }): HistoryEntry[] {
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
