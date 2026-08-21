export const SESSION_SORT_FIELDS = ['user', 'host', 'startedAt', 'endedAt', 'duration', 'connectionMethod', 'active'] as const
export type SessionSortBy = typeof SESSION_SORT_FIELDS[number]
export type SessionSortDirection = 'asc' | 'desc'

export function normalizeSessionSort(sortBy?: string, sortDirection?: string): {
  sortBy: SessionSortBy
  sortDirection: SessionSortDirection
} {
  return {
    sortBy: SESSION_SORT_FIELDS.includes(sortBy as SessionSortBy) ? sortBy as SessionSortBy : 'startedAt',
    sortDirection: sortDirection === 'asc' ? 'asc' : 'desc',
  }
}
