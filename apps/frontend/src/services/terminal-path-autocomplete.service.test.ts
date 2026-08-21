import { beforeEach, describe, expect, it, vi } from 'vitest'
const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('./sftp.service', () => ({ sftpService: { list } }))
import { canSuggestRemotePaths, clearRemotePathAutocomplete, remotePathAutocompleteMetrics, resetRemotePathAutocompleteMetrics, suggestRemotePaths, suggestRemotePathsDetailed } from './terminal-path-autocomplete.service'
import { handleTerminalSftpResult, registerTerminalSftpChannel } from './terminal-sftp-channel.service'

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

  it('prefers the persistent SFTP channel of the active SSH session over REST', async () => {
    let sentRequest: Record<string, unknown> = {}
    const unregister = registerTerminalSftpChannel(77, (raw) => {
      const request = JSON.parse(raw)
      sentRequest = request
      handleTerminalSftpResult(77, { type: 'sftp_result', requestId: request.requestId, ok: true, path: request.path, entries: [{ name: 'log', type: 'directory' }] })
    })
    try {
      const items = await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 77, line: 'cd /var/lo' })
      expect(items[0]?.value).toBe('cd /var/log/')
      expect(sentRequest).toMatchObject({ prefix: 'lo', directoriesOnly: true, limit: 96 })
      expect(list).not.toHaveBeenCalled()
    } finally { unregister() }
  })

  it('opens an exact directory so cd /var immediately suggests its children', async () => {
    list.mockImplementation((_hostId, path) => Promise.resolve({ data: { entries: path === '/'
      ? [{ name: 'var', type: 'directory' }, { name: 'var.log', type: 'file' }]
      : [{ name: 'log', type: 'directory' }, { name: 'lib', type: 'directory' }, { name: 'README', type: 'file' }] } }))
    const input = { tenantId: 1, hostId: 2, sessionId: 3, line: 'cd /var' }
    const result = await suggestRemotePathsDetailed(input)
    expect(result).toMatchObject({ state: 'ready', directory: '/var' })
    expect(result.items.map((item) => item.value)).toEqual(['cd /var/lib/', 'cd /var/log/'])
    expect(list.mock.calls.map((call) => call[1])).toEqual(['/', '/var'])
    await suggestRemotePaths(input)
    expect(list).toHaveBeenCalledTimes(2)
    expect(remotePathAutocompleteMetrics()).toMatchObject({ exactDirectoryExpansions: 2, cacheHits: 2 })
  })

  it('resolves relative paths from the terminal working directory', async () => {
    list.mockResolvedValue({ data: { entries: [{ name: 'log', type: 'directory' }] } })
    const values = await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, currentDirectory: '/var', line: 'cd lo' })
    expect(list).toHaveBeenCalledWith(2, '/var', expect.any(Object))
    expect(values[0]?.value).toBe('cd log/')
  })

  it('understands options, sudo and chained commands without executing anything', async () => {
    list.mockResolvedValue({ data: { entries: [{ name: 'nginx.conf', type: 'file' }] } })
    const base = { tenantId: 1, hostId: 2, sessionId: 3 }
    expect((await suggestRemotePaths({ ...base, line: 'sudo -u root vim /etc/ng' }))[0]?.value).toBe('sudo -u root vim /etc/nginx.conf')
    clearRemotePathAutocomplete()
    expect((await suggestRemotePaths({ ...base, line: 'echo ok && ls -lah /etc/ng' }))[0]?.value).toBe('echo ok && ls -lah /etc/nginx.conf')
  })

  it.each([
    ['ls "/var/app', 'ls /var/application\\ logs/'],
    ['ls /var/application\\ l', 'ls /var/application\\ logs/'],
    ['echo ready; cd /var/lo', 'echo ready; cd /var/log/'],
    ['sudo --user=root vim /etc/ng', 'sudo --user=root vim /etc/nginx.conf'],
  ])('safely parses shell shape %s', async (line, expected) => {
    list.mockResolvedValue({ data: { entries: line.includes('/etc/') ? [{ name: 'nginx.conf', type: 'file' }] : line.includes('application') || line.includes('app') ? [{ name: 'application logs', type: 'directory' }] : [{ name: 'log', type: 'directory' }] } })
    expect((await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line }))[0]?.value).toBe(expected)
  })

  it('filters files from commands that require directories', async () => {
    list.mockResolvedValue({ data: { entries: [{ name: 'log', type: 'directory' }, { name: 'local.conf', type: 'file' }] } })
    const values = (await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line: 'cd /var/lo' })).map((item) => item.value)
    expect(values).toEqual(['cd /var/log/'])
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

  it('neutralizes option-like relative names and preserves hidden and Unicode paths', async () => {
    list.mockResolvedValue({ data: { entries: [
      { name: '-rf', type: 'file' },
      { name: '.configuração', type: 'directory' },
      { name: 'relatórios ção', type: 'directory' },
    ] } })
    const base = { tenantId: 1, hostId: 2, sessionId: 3 }
    expect((await suggestRemotePaths({ ...base, line: 'ls ' })).map((item) => item.value)).toContain('ls ./-rf')
    clearRemotePathAutocomplete()
    expect((await suggestRemotePaths({ ...base, line: 'ls ./-' }))[0]?.value).toBe('ls ./-rf')
    clearRemotePathAutocomplete()
    expect((await suggestRemotePaths({ ...base, line: 'cd .c' }))[0]?.value).toBe('cd .configuração/')
    clearRemotePathAutocomplete()
    expect((await suggestRemotePaths({ ...base, line: 'cd rel' }))[0]?.value).toBe('cd relatórios\\ ção/')
  })

  it('supports common path-bearing flags and two-operand commands', async () => {
    list.mockResolvedValue({ data: { entries: [{ name: 'syslog', type: 'file' }, { name: 'system', type: 'directory' }] } })
    const base = { tenantId: 1, hostId: 2, sessionId: 3 }
    expect((await suggestRemotePaths({ ...base, line: 'tail -f /var/sy' })).map((item) => item.value)).toContain('tail -f /var/syslog')
    clearRemotePathAutocomplete()
    expect((await suggestRemotePaths({ ...base, line: 'cp /tmp/source /var/sy' })).map((item) => item.value)).toContain('cp /tmp/source /var/system/')
  })

  it.each(['file /var/sy', 'readlink /var/sy', 'realpath /var/sy', 'source /var/sy', 'wc /var/sy', 'diff /tmp/old /var/sy', 'cat /tmp/in | tail -f /var/sy'])('supports expanded shell grammar: %s', async (line) => {
    list.mockResolvedValue({ data: { entries: [{ name: 'syslog', type: 'file', permissions: '-rw-r-----' }] } })
    const item = (await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line }))[0]
    expect(item?.value).toContain('/var/syslog')
    expect(item?.metadataLabel).toBe('rw-r-----')
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
    for (let index = 0; index < 102; index += 1) {
      await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line: `cd /directory-${index}/r` })
    }
    const snapshot = remotePathAutocompleteMetrics()
    expect(snapshot).toMatchObject({ requests: 102, cacheMisses: 102, cacheSize: 96, evictions: 6 })
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
