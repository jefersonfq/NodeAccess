import { describe, expect, it } from 'vitest'
import type { Snippet, SnippetGroup } from './snippet.service'
import { groupSnippets } from './snippet-grouping.service'

function snippet(id: number, groupId: number | null): Snippet {
  return {
    id,
    name: `Snippet ${id}`,
    command: `echo ${id}`,
    description: null,
    scope: 'TEAM',
    groupId,
    group: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    createdBy: { id: 1, name: 'Admin' },
  }
}

function group(id: number): SnippetGroup {
  return {
    id,
    name: `Grupo ${id}`,
    description: null,
    scope: 'TEAM',
    createdById: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  }
}

describe('snippet grouped view', () => {
  it('preserves snippets whose group is unavailable instead of hiding them', () => {
    const buckets = groupSnippets([snippet(1, 99)], [])
    expect(buckets).toEqual([{ group: null, snippets: [snippet(1, 99)], unavailableGroupId: 99 }])
  })

  it('keeps known, unavailable and ungrouped snippets in predictable order', () => {
    const rows = [snippet(1, 10), snippet(2, 99), snippet(3, null), snippet(4, 98)]
    const buckets = groupSnippets(rows, [group(10)])
    expect(buckets.map(bucket => bucket.group?.id ?? (bucket.unavailableGroupId != null ? `unavailable-${bucket.unavailableGroupId}` : 'ungrouped'))).toEqual([
      10,
      'unavailable-99',
      'unavailable-98',
      'ungrouped',
    ])
    expect(buckets.flatMap(bucket => bucket.snippets).map(row => row.id).sort()).toEqual([1, 2, 3, 4])
  })

  it('does not render empty groups', () => {
    expect(groupSnippets([snippet(1, null)], [group(10)])).toEqual([{ group: null, snippets: [snippet(1, null)] }])
  })
})
