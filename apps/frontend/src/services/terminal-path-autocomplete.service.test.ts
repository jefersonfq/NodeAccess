import { beforeEach, describe, expect, it, vi } from 'vitest'
const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('./sftp.service', () => ({ sftpService: { list } }))
import { canSuggestRemotePaths, clearRemotePathAutocomplete, remotePathAutocompleteMetrics, resetRemotePathAutocompleteMetrics, suggestRemotePaths } from './terminal-path-autocomplete.service'

describe('remote terminal path autocomplete', () => {
  beforeEach(() => { list.mockReset(); clearRemotePathAutocomplete(); resetRemotePathAutocompleteMetrics() })

  it('completes paths and caches only within tenant/host/session context', async () => {
    list.mockResolvedValue({ data: { entries: [{ name: 'log', type: 'directory' }, { name: 'local', type: 'directory' }] } })
    const input = { tenantId: 1, hostId: 2, sessionId: 3, line: 'cd /var/lo' }
    expect((await suggestRemotePaths(input))[0]?.value).toBe('cd /var/local/')
    await suggestRemotePaths(input)
    expect(list).toHaveBeenCalledOnce()
    await suggestRemotePaths({ ...input, sessionId: 4 })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('does not query SFTP for unsupported command shapes', async () => {
    await expect(suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line: 'echo /var/lo' })).resolves.toEqual([])
    expect(list).not.toHaveBeenCalled()
    expect(canSuggestRemotePaths('echo /var/lo')).toBe(false)
    expect(canSuggestRemotePaths('vim /var/lo')).toBe(true)
  })

  it('deduplicates concurrent SFTP requests for the same isolated directory', async () => {
    list.mockResolvedValue({ data: { entries: [{ name: 'log', type: 'directory' }] } })
    const base = { tenantId: 1, hostId: 2, sessionId: 3 }
    await Promise.all([
      suggestRemotePaths({ ...base, line: 'cd /var/l' }),
      suggestRemotePaths({ ...base, line: 'cd /var/lo' }),
    ])
    expect(list).toHaveBeenCalledOnce()
  })

  it('orders directories first, sorts names and caps the visible list', async () => {
    list.mockResolvedValue({ data: { entries: [
      { name: 'z-file', type: 'file' },
      { name: 'b-dir', type: 'directory' },
      { name: 'a-dir', type: 'directory' },
      ...Array.from({ length: 10 }, (_, index) => ({ name: `file-${index}`, type: 'file' })),
    ] } })
    const values = (await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line: 'ls ' })).map((item) => item.value)
    expect(values).toHaveLength(8)
    expect(values.slice(0, 2)).toEqual(['ls a-dir/', 'ls b-dir/'])
  })

  it('escapes whitespace and shell metacharacters in remote names', async () => {
    list.mockResolvedValue({ data: { entries: [
      { name: 'application logs', type: 'directory' },
      { name: 'cost$(date).txt', type: 'file' },
      { name: 'bad\nname', type: 'file' },
    ] } })
    const values = (await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line: 'ls ' })).map((item) => item.value)
    expect(values).toContain('ls application\\ logs/')
    expect(values).toContain('ls cost\\$\\(date\\).txt')
    expect(values.some((value) => value.includes('\n'))).toBe(false)
  })

  it('uses a short negative cache during SFTP outages', async () => {
    list.mockRejectedValue(new Error('connection lost'))
    const input = { tenantId: 1, hostId: 2, sessionId: 3, line: 'cd /var/l' }
    await expect(suggestRemotePaths(input)).resolves.toEqual([])
    await expect(suggestRemotePaths({ ...input, line: 'cd /var/lo' })).resolves.toEqual([])
    expect(list).toHaveBeenCalledOnce()
  })

  it('isolates cache by tenant, host and anonymous session', async () => {
    list.mockResolvedValue({ data: { entries: [{ name: 'log', type: 'directory' }] } })
    const base = { tenantId: 1, hostId: 2, sessionId: null, line: 'cd /var/l' }
    await suggestRemotePaths(base)
    await suggestRemotePaths({ ...base, tenantId: 2 })
    await suggestRemotePaths({ ...base, hostId: 3 })
    expect(list).toHaveBeenCalledTimes(3)
  })

  it('aborts obsolete requests without creating a false negative cache', async () => {
    list.mockImplementation((_hostId, _path, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const controller = new AbortController()
    const request = suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line: 'cd /slow/a', signal: controller.signal })
    controller.abort()
    await expect(request).resolves.toEqual([])
    expect(remotePathAutocompleteMetrics()).toMatchObject({ aborted: 1, errors: 0, cacheSize: 0 })
  })

  it('bounds the LRU cache and reports only aggregate performance counters', async () => {
    list.mockResolvedValue({ data: { entries: [{ name: 'result', type: 'directory' }] } })
    for (let index = 0; index < 70; index += 1) {
      await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line: `cd /directory-${index}/r` })
    }
    const snapshot = remotePathAutocompleteMetrics()
    expect(snapshot).toMatchObject({ requests: 70, cacheMisses: 70, cacheSize: 64, evictions: 6 })
    expect(Object.keys(snapshot).some((key) => /line|path|command/i.test(key))).toBe(false)
  })

  it('invalidates only the requested tenant, host and session scope', async () => {
    list.mockResolvedValue({ data: { entries: [{ name: 'log', type: 'directory' }] } })
    const one = { tenantId: 1, hostId: 2, sessionId: 3, line: 'cd /var/l' }
    const two = { tenantId: 1, hostId: 2, sessionId: 4, line: 'cd /var/l' }
    await suggestRemotePaths(one); await suggestRemotePaths(two)
    clearRemotePathAutocomplete({ tenantId: 1, hostId: 2, sessionId: 3 })
    await suggestRemotePaths(one); await suggestRemotePaths(two)
    expect(list).toHaveBeenCalledTimes(3)
  })
})
