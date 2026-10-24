type FolderNode = { id: number; parentId: number | null; name: string; type?: string }

/** Uses only loaded, authorized nodes; unknown ancestors are never guessed. */
export function hostFolderBreadcrumb(
  folderId: number | null | undefined,
  folders: ReadonlyMap<number, FolderNode>,
  rootLabel: string,
): string | null {
  if (folderId == null || !folders.has(folderId)) return null
  const parts: string[] = []
  const visited = new Set<number>()
  let currentId: number | null = folderId
  while (currentId !== null) {
    const node = folders.get(currentId)
    if (!node || visited.has(currentId)) return ['…', ...parts].join(' → ')
    visited.add(currentId)
    if (node.type === 'ROOT') return [rootLabel, ...parts].join(' → ')
    parts.unshift(node.name.trim())
    currentId = node.parentId
  }
  return [rootLabel, ...parts].join(' → ')
}
