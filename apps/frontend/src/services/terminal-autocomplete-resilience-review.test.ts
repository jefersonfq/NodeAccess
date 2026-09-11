import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('./sftp.service', () => ({ sftpService: { list } }))
import { clearRemotePathAutocomplete, suggestRemotePathsDetailed } from './terminal-path-autocomplete.service'
import { TerminalSessionEntityIndex } from './terminal-session-entity-index.service'
import { terminalCompletionInsertion } from './terminal-autocomplete.service'
import { setTerminalAutocompleteHistoryEnabled, clearTerminalAutocompleteHistory, recordTerminalAutocompleteHistory, readTerminalAutocompleteHistory } from './terminal-autocomplete-history.service'

const scope = { tenantId: 41, hostId: 42, sessionId: 43, line: 'ls /tmp/r' }
const historyScope = { userId: 44, tenantId: 41, hostId: 42 }
const storage = new Map<string, string>()
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
function result(name: string) { return { data: { entries: [{ name, type: 'file' }] } } }

beforeEach(() => {
  list.mockReset(); clearRemotePathAutocomplete(); storage.clear()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  } })
  clearTerminalAutocompleteHistory(historyScope)
  setTerminalAutocompleteHistoryEnabled(historyScope, true)
})
afterEach(() => {
  vi.useRealTimers()
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('autocomplete review: user and failure simulations', () => {
  it('keeps parallel tenants, hosts and sessions independent', async () => {
    list.mockResolvedValue(result('report'))
    const contexts = [scope, { ...scope, tenantId: 51 }, { ...scope, hostId: 52 }, { ...scope, sessionId: 53 }]
    await Promise.all(contexts.map(input => suggestRemotePathsDetailed(input)))
    expect(list).toHaveBeenCalledTimes(4)
    await Promise.all(contexts.map(input => suggestRemotePathsDetailed(input)))
    expect(list).toHaveBeenCalledTimes(4)
  })
  it('recovers after a brief outage without caching failure for the success TTL', async () => {
    vi.useFakeTimers()
    list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(result('recovered'))
    expect((await suggestRemotePathsDetailed(scope)).state).toBe('error')
    await suggestRemotePathsDetailed(scope); expect(list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1001)
    expect((await suggestRemotePathsDetailed(scope)).items[0]?.value).toBe('ls /tmp/recovered')
    expect(list).toHaveBeenCalledTimes(2)
  })
  it('separates a genuine empty directory from a denied lookup', async () => {
    list.mockResolvedValueOnce({ data: { entries: [] } }).mockRejectedValueOnce(new Error('permission denied'))
    expect((await suggestRemotePathsDetailed(scope)).state).toBe('empty')
    expect((await suggestRemotePathsDetailed({ ...scope, sessionId: 55 })).state).toBe('error')
  })
  it('isolates remembered commands by user as well as tenant and host', () => {
    recordTerminalAutocompleteHistory(historyScope, 'uptime')
    for (const other of [{ ...historyScope, userId: 54 }, { ...historyScope, tenantId: 51 }, { ...historyScope, hostId: 52 }]) expect(readTerminalAutocompleteHistory(other)).toEqual([])
    expect(readTerminalAutocompleteHistory(historyScope)).toEqual(['uptime'])
  })
  it('ignores damaged browser history and remains usable', () => {
    storage.set('na:terminal-autocomplete-history:44:41:42', '{broken')
    expect(readTerminalAutocompleteHistory(historyScope)).toEqual([])
    expect(recordTerminalAutocompleteHistory(historyScope, 'pwd')).toBe(true)
    expect(readTerminalAutocompleteHistory(historyScope)).toEqual(['pwd'])
  })
  it('turns malformed remote payload into a bounded error state', async () => {
    list.mockResolvedValue({ data: { entries: null } })
    expect((await suggestRemotePathsDetailed(scope)).state).toBe('error')
  })

  // Regression cases from the review; all must now pass normally.
  it('AC-01: preserves escaped parent directories in the proposed shell operand', async () => {
    list.mockResolvedValue(result('report.txt'))
    const response = await suggestRemotePathsDetailed({ ...scope, line: 'cat /tmp/team\\ docs/re' })
    expect(response.items[0]?.value).toBe('cat /tmp/team\\ docs/report.txt')
  })
  it('AC-02: resolves a nested home path independently of the current directory', async () => {
    list.mockResolvedValue(result('report.txt'))
    await suggestRemotePathsDetailed({ ...scope, currentDirectory: '/var/log', line: 'cat ~/docs/re' })
    expect(list.mock.calls[0]?.[1]).toBe('docs')
  })
  it('AC-03: never reuses a lookup that completed after cache invalidation', async () => {
    let finish!: (value: ReturnType<typeof result>) => void
    list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = suggestRemotePathsDetailed(scope)
    clearRemotePathAutocomplete(scope)
    finish(result('removed.txt')); await pending
    list.mockResolvedValue(result('replacement.txt'))
    const response = await suggestRemotePathsDetailed(scope)
    expect(response.items[0]?.value).toBe('ls /tmp/replacement.txt')
  })
  it('AC-04: browser quota exhaustion must not escape the command-success handler', () => {
    localStorage.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
    expect(() => recordTerminalAutocompleteHistory(historyScope, 'uptime')).not.toThrow()
  })
  it('AC-05: rejects filenames containing a newline instead of changing their identity', async () => {
    list.mockResolvedValue(result('report\n.txt'))
    const response = await suggestRemotePathsDetailed(scope)
    expect(response.items).toEqual([])
  })
  it('AC-07: namespaces from kubectl -A must not become pod names', () => {
    const index = new TerminalSessionEntityIndex()
    index.observe('kubectl get pods -A', 'NAMESPACE NAME READY STATUS\npayments api-1 1/1 Running\n')
    expect(index.suggest('kubectl logs pay')).toEqual([])
  })
  it('AC-08: session entities remain intact when output arrives in separate chunks', () => {
    const index = new TerminalSessionEntityIndex()
    index.observe('systemctl --failed', 'nodeaccess-age')
    index.observe('systemctl --failed', 'nt.service loaded failed\n')
    expect(index.suggest('systemctl status node')[0]?.value).toBe('systemctl status nodeaccess-agent.service')
  })
  it('AC-06: replacing a command at a mid-line cursor removes the old suffix too', () => {
    let line = 'ls /tmp/old.txt'; let cursor = 6
    const replacement = 'ls /tmp/report.txt'
    const bytes = terminalCompletionInsertion(line.slice(0, cursor), replacement, true)
    for (const char of bytes) {
      if (char === '\u0015') { line = line.slice(cursor); cursor = 0 }
      else if (char === '\u0001') cursor = 0
      else if (char === '\u0005') cursor = line.length
      else if (char === '\u000b') line = line.slice(0, cursor)
      else { line = line.slice(0, cursor) + char + line.slice(cursor); cursor++ }
    }
    expect(line).toBe(replacement)
  })
  it.each([
    ['cat "/tmp/team docs/re', '/tmp/team docs', 'cat /tmp/team\\ docs/report.txt'],
    ["cat '/tmp/team docs/re", '/tmp/team docs', 'cat /tmp/team\\ docs/report.txt'],
    ['cat ~/team\\ docs/re', 'team docs', 'cat ~/team\\ docs/report.txt'],
    ["cat '~'/docs/re", '/work/~/docs', 'cat \\~/docs/report.txt'],
  ])('keeps quoted and home paths literal: %s', async (line, directory, expected) => {
    list.mockResolvedValue(result('report.txt'))
    const response = await suggestRemotePathsDetailed({ ...scope, line, currentDirectory: '/work' })
    expect(list.mock.calls[0]?.[1]).toBe(directory)
    expect(response.items[0]?.value).toBe(expected)
  })
  it('retains literal backslashes in a parent and in a filename prefix', async () => {
    list.mockResolvedValue(result('re\\port'))
    const response = await suggestRemotePathsDetailed({ ...scope, line: "cat '/tmp/a\\b/re\\p" })
    expect(list.mock.calls[0]?.[1]).toBe('/tmp/a\\b')
    expect(response.items[0]?.value).toBe('cat /tmp/a\\\\b/re\\\\port')
  })
  it('keeps history usable in memory and clears it even when storage is denied', () => {
    localStorage.setItem = () => { throw new Error('denied') }
    localStorage.removeItem = () => { throw new Error('denied') }
    recordTerminalAutocompleteHistory(historyScope, 'uptime')
    expect(readTerminalAutocompleteHistory(historyScope)).toEqual(['uptime'])
    expect(() => clearTerminalAutocompleteHistory(historyScope)).not.toThrow()
    expect(readTerminalAutocompleteHistory(historyScope)).toEqual([])
  })
  it('keeps equal pod names in separate namespaces and ignores deployments as pods', () => {
    const index = new TerminalSessionEntityIndex()
    index.observe('kubectl get pods --all-namespaces', 'NAMESPACE NAME READY\nblue api-1 1/1\ngreen api-1 1/1\n')
    expect(index.suggest('kubectl logs api').map(item => item.value)).toEqual(['kubectl logs api-1 -n blue', 'kubectl logs api-1 -n green'])
    index.observe('kubectl get deployments', 'NAME READY\nweb 1/1\n')
    expect(index.suggest('kubectl logs web')).toEqual([])
    index.clear()
    expect(index.suggest('kubectl logs api')).toEqual([])
  })
  it('does not join a partial line from a previous command or cleared session', () => {
    const index = new TerminalSessionEntityIndex()
    index.observe('systemctl --failed', 'old-')
    index.observe('systemctl status', 'new.service loaded\n')
    expect(index.suggest('systemctl status new')[0]?.value).toBe('systemctl status new.service')
    index.observe('systemctl status', 'partial-')
    index.clear()
    index.observe('systemctl status', 'fresh.service loaded\n')
    expect(index.suggest('systemctl status fresh')[0]?.value).toBe('systemctl status fresh.service')
  })
  it('does not let an invalidated request remove a newer pending lookup', async () => {
    let oldFinish!: (value: ReturnType<typeof result>) => void
    let newFinish!: (value: ReturnType<typeof result>) => void
    list.mockImplementationOnce(() => new Promise(resolve => { oldFinish = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { newFinish = resolve }))
    const old = suggestRemotePathsDetailed(scope)
    clearRemotePathAutocomplete(scope)
    const fresh = suggestRemotePathsDetailed(scope)
    oldFinish(result('removed')); await old
    const joined = suggestRemotePathsDetailed(scope)
    expect(list).toHaveBeenCalledTimes(2)
    newFinish(result('replacement'))
    expect((await fresh).items).toEqual((await joined).items)
  })

  it('allows opting out per user and host without changing another scope', () => {
    setTerminalAutocompleteHistoryEnabled(historyScope, false)
    expect(recordTerminalAutocompleteHistory(historyScope, 'pwd')).toBe(false)
    expect(readTerminalAutocompleteHistory(historyScope)).toEqual([])
    expect(recordTerminalAutocompleteHistory({ ...historyScope, hostId: 99 }, 'pwd')).toBe(true)
    setTerminalAutocompleteHistoryEnabled(historyScope, true)
    expect(recordTerminalAutocompleteHistory(historyScope, 'pwd')).toBe(true)
  })

  it('keeps parent traversal for SFTP to resolve symlinks correctly', async () => {
    list.mockResolvedValue(result('report'))
    await suggestRemotePathsDetailed({ ...scope, line: 'ls ~/../shared/re', currentDirectory: '/work' })
    expect(list.mock.calls[0]?.[1]).toBe('../shared')
  })
  it('discards oversized partial lines without inventing an entity from their suffix', () => {
    const index = new TerminalSessionEntityIndex()
    index.observe('systemctl --failed', 'x'.repeat(9000))
    index.observe('systemctl --failed', 'wrong.service loaded\nright.service loaded\n')
    expect(index.suggest('systemctl status wrong')).toEqual([])
    expect(index.suggest('systemctl status right')[0]?.value).toBe('systemctl status right.service')
  })
  it.each(['pwd\u001b[2J', 'ls\u0015rm', 'pwd\t'])('does not remember terminal control bytes: %s', command => {
    expect(recordTerminalAutocompleteHistory(historyScope, command)).toBe(false)
  })

  it('uses the real directory casing when expanding an exact directory', async () => {
    list.mockResolvedValueOnce({ data: { entries: [{ name: 'Logs', type: 'directory' }] } })
      .mockResolvedValueOnce({ data: { entries: [{ name: 'Archive', type: 'directory' }] } })
    const response = await suggestRemotePathsDetailed({ ...scope, line: 'cd /var/logs' })
    expect(response.items[0]?.value).toBe('cd /var/Logs/Archive/')
  })

})
