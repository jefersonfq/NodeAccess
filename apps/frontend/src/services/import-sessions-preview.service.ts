export interface ImportSessionsPreviewHost {
  key: string
  name: string
  ip: string
  port: number
  folderPath: string[]
}

export interface ImportSessionsPreviewRow {
  key: string
  kind: 'folder' | 'host'
  name: string
  depth: number
  hostCount?: number
  endpoint?: string
}

interface TreeNode {
  key: string
  name: string
  folders: Map<string, TreeNode>
  hosts: ImportSessionsPreviewHost[]
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function hostCount(node: TreeNode): number {
  return node.hosts.length + [...node.folders.values()].reduce((total, child) => total + hostCount(child), 0)
}

function flatten(node: TreeNode, depth: number, rows: ImportSessionsPreviewRow[]): void {
  rows.push({ key: node.key, kind: 'folder', name: node.name, depth, hostCount: hostCount(node) })
  const folders = [...node.folders.values()].sort((left, right) => left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
  for (const child of folders) flatten(child, depth + 1, rows)
  for (const host of [...node.hosts].sort((left, right) => left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))) {
    rows.push({
      key: `host:${host.key}`,
      kind: 'host',
      name: host.name,
      depth: depth + 1,
      endpoint: `${host.ip}:${host.port}`,
    })
  }
}

export function buildImportSessionsPreview(
  destinationName: string,
  hosts: ImportSessionsPreviewHost[],
  preserveHierarchy: boolean,
  includeDestination = true,
): ImportSessionsPreviewRow[] {
  const root: TreeNode = {
    key: 'destination',
    name: destinationName,
    folders: new Map(),
    hosts: [],
  }

  for (const host of hosts) {
    let parent = root
    if (preserveHierarchy) {
      for (const rawSegment of host.folderPath) {
        const name = rawSegment.trim()
        if (!name) continue
        const segmentKey = normalized(name)
        let child = parent.folders.get(segmentKey)
        if (!child) {
          child = {
            key: `${parent.key}/folder:${segmentKey}`,
            name,
            folders: new Map(),
            hosts: [],
          }
          parent.folders.set(segmentKey, child)
        }
        parent = child
      }
    }
    parent.hosts.push(host)
  }

  const rows: ImportSessionsPreviewRow[] = []
  if (includeDestination) flatten(root, 0, rows)
  else {
    for (const child of [...root.folders.values()].sort((left, right) => left.name.localeCompare(right.name))) {
      flatten(child, 0, rows)
    }
    for (const host of root.hosts) {
      rows.push({ key: `host:${host.key}`, kind: 'host', name: host.name, depth: 0, endpoint: `${host.ip}:${host.port}` })
    }
  }
  return rows
}
