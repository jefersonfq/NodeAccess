import { beforeEach, describe, expect, it } from 'vitest'
import { clearTerminalAutocompleteHistory, isSafeHistoryValue, readTerminalAutocompleteHistory, recordTerminalAutocompleteHistory } from './terminal-autocomplete-history.service'

const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
} })

describe('terminal autocomplete history', () => {
  const scope = { userId: 1, tenantId: 2, hostId: 3 }
  beforeEach(() => values.clear())

  it('ranks recent templates without sharing them across users or hosts', () => {
    recordTerminalAutocompleteHistory(scope, 'systemctl --failed')
    recordTerminalAutocompleteHistory(scope, 'df -h')
    expect(readTerminalAutocompleteHistory(scope)).toEqual(['df -h', 'systemctl --failed'])
    expect(readTerminalAutocompleteHistory({ ...scope, hostId: 4 })).toEqual([])
    clearTerminalAutocompleteHistory(scope)
    expect(readTerminalAutocompleteHistory(scope)).toEqual([])
  })

  it('refuses secrets, control characters and oversized values', () => {
    for (const value of ['TOKEN=abc', 'password: value', 'echo ok\nrm -rf /', `x${'a'.repeat(256)}`]) {
      expect(isSafeHistoryValue(value)).toBe(false)
      expect(recordTerminalAutocompleteHistory(scope, value)).toBe(false)
    }
    expect(values.size).toBe(0)
  })

  it('keeps a bounded deduplicated history', () => {
    for (let index = 0; index < 40; index += 1) recordTerminalAutocompleteHistory(scope, `safe-command-${index}`)
    recordTerminalAutocompleteHistory(scope, 'safe-command-20')
    const history = readTerminalAutocompleteHistory(scope)
    expect(history).toHaveLength(24)
    expect(history[0]).toBe('safe-command-20')
    expect(new Set(history).size).toBe(history.length)
  })

  it('combines frequency and recency and migrates the legacy string format', () => {
    recordTerminalAutocompleteHistory(scope, 'df -h')
    recordTerminalAutocompleteHistory(scope, 'uptime')
    recordTerminalAutocompleteHistory(scope, 'df -h')
    expect(readTerminalAutocompleteHistory(scope).slice(0, 2)).toEqual(['df -h', 'uptime'])
    values.set(`na:terminal-autocomplete-history:${scope.userId}:${scope.tenantId}:${scope.hostId}`, JSON.stringify(['pwd', 'free -h']))
    expect(readTerminalAutocompleteHistory(scope)).toEqual(['pwd', 'free -h'])
  })

  it('rejects credentials embedded in URLs and long-form CLI flags', () => {
    expect(isSafeHistoryValue('mysql --password supersecret')).toBe(false)
    expect(isSafeHistoryValue('curl https://user:pass@example.test')).toBe(false)
  })
})
