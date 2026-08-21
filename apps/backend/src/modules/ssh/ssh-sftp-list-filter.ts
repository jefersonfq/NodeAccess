export interface SftpListFilterOptions {
  prefix?: string
  directoriesOnly?: boolean
  limit?: number
}

interface SftpListEntry {
  name?: unknown
  type?: unknown
}

export function filterSftpDirectoryEntries<T extends SftpListEntry>(entries: T[], options: SftpListFilterOptions): T[] {
  const prefix = typeof options.prefix === 'string' ? options.prefix.toLowerCase().slice(0, 255) : ''
  const limit = Number.isInteger(options.limit) ? Math.min(256, Math.max(1, Number(options.limit))) : null
  const filtered = entries
    .filter((entry) => (!prefix || String(entry.name ?? '').toLowerCase().startsWith(prefix)) && (!options.directoriesOnly || entry.type === 'directory'))
    .sort((left, right) => Number(right.type === 'directory') - Number(left.type === 'directory') || String(left.name ?? '').localeCompare(String(right.name ?? '')))

  return limit ? filtered.slice(0, limit) : filtered
}
