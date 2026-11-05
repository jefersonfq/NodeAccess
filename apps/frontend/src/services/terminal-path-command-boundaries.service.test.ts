import { beforeEach, describe, expect, it, vi } from 'vitest'
const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('./sftp.service', () => ({ sftpService: { list } }))
import { clearRemotePathAutocomplete, suggestRemotePaths } from './terminal-path-autocomplete.service'

describe('remote autocomplete command boundaries', () => {
  beforeEach(() => { list.mockReset(); clearRemotePathAutocomplete() })

  it.each([';', ';;', '|', '||', '&&'])('preserves the preceding command and skips the entire %s separator', async separator => {
    list.mockResolvedValue({ data: { entries: [{ name: 'log', type: 'directory' }] } })
    const prefix = `echo '中😀;|&&' ${separator} `
    const result = await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line: `${prefix}cd /var/lo` })
    expect(result.map(item => item.value)).toEqual([`${prefix}cd /var/log/`])
    expect(list).toHaveBeenCalledWith(2, '/var', { signal: undefined })
  })

  it.each(["echo 'unfinished; cd /var/lo", 'echo escaped\\; cd /var/lo', 'echo x & cd /var/lo'])('does not treat quoted, escaped, or single ampersand text as a command boundary %#', async line => {
    expect(await suggestRemotePaths({ tenantId: 1, hostId: 2, sessionId: 3, line })).toEqual([])
    expect(list).not.toHaveBeenCalled()
  })

})
