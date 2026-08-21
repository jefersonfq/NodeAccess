import { describe, expect, it } from 'vitest'
import { filterSftpDirectoryEntries } from './ssh-sftp-list-filter.js'

describe('SFTP directory filtering', () => {
  it('filters large listings on the server and prioritizes directories', () => {
    const entries = [
      ...Array.from({ length: 10_000 }, (_, index) => ({ name: `file-${index}`, type: 'file' })),
      { name: 'logs-old', type: 'file' },
      { name: 'logs', type: 'directory' },
      { name: 'local', type: 'directory' },
    ]
    expect(filterSftpDirectoryEntries(entries, { prefix: 'lo', directoriesOnly: true, limit: 2 }))
      .toEqual([{ name: 'local', type: 'directory' }, { name: 'logs', type: 'directory' }])
  })

  it('caps unsafe limits and does not mutate the source collection', () => {
    const entries = [{ name: 'z', type: 'file' }, { name: 'a', type: 'directory' }]
    expect(filterSftpDirectoryEntries(entries, { limit: 50_000 })).toEqual([{ name: 'a', type: 'directory' }, { name: 'z', type: 'file' }])
    expect(entries.map((entry) => entry.name)).toEqual(['z', 'a'])
  })
})
