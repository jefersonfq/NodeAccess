import { describe, expect, it } from 'vitest'
import { normalizeSessionSort } from './session-list-query.js'

describe('normalizeSessionSort', () => {
  it('keeps supported fields and directions', () => {
    expect(normalizeSessionSort('user', 'asc')).toEqual({ sortBy: 'user', sortDirection: 'asc' })
    expect(normalizeSessionSort('duration', 'desc')).toEqual({ sortBy: 'duration', sortDirection: 'desc' })
  })

  it('rejects arbitrary SQL identifiers and falls back safely', () => {
    expect(normalizeSessionSort('started_at DESC; DROP TABLE sessions', 'sideways'))
      .toEqual({ sortBy: 'startedAt', sortDirection: 'desc' })
  })
})
