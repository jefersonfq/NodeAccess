import type { Snippet, SnippetGroup } from './snippet.service'

export interface SnippetBucket {
  group: SnippetGroup | null
  snippets: Snippet[]
  unavailableGroupId?: number
}

export function groupSnippets(snippets: Snippet[], groups: SnippetGroup[]): SnippetBucket[] {
  const byGroupId = new Map<number, Snippet[]>()
  const ungrouped: Snippet[] = []
  for (const snippet of snippets) {
    if (snippet.groupId == null) {
      ungrouped.push(snippet)
      continue
    }
    const items = byGroupId.get(snippet.groupId) ?? []
    items.push(snippet)
    byGroupId.set(snippet.groupId, items)
  }

  const buckets: SnippetBucket[] = []
  const availableGroupIds = new Set(groups.map(group => group.id))
  for (const group of groups) {
    const items = byGroupId.get(group.id)
    if (items?.length) buckets.push({ group, snippets: items })
  }
  for (const [groupId, items] of byGroupId) {
    if (!availableGroupIds.has(groupId) && items.length) buckets.push({ group: null, snippets: items, unavailableGroupId: groupId })
  }
  if (ungrouped.length) buckets.push({ group: null, snippets: ungrouped })
  return buckets
}
