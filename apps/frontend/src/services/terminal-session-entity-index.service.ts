import type { TerminalCompletion } from './terminal-autocomplete.service'

type EntityKind = 'systemd' | 'docker' | 'kubernetes' | 'git'
const MAX_PER_KIND = 128
const SAFE_ENTITY = /^[A-Za-z0-9][A-Za-z0-9@_.:/-]{0,127}$/

export class TerminalSessionEntityIndex {
  private entities = new Map<EntityKind, Map<string, number>>()

  private discardPartialLine = false
  private remainder = ''
  private command = ''
  private podNamespaces = new Map<string, string>()

  observe(command: string, output: string) {
    if (command !== this.command) { this.remainder = ''; this.discardPartialLine = false; this.command = command }
    if (this.discardPartialLine) {
      const newline = output.indexOf('\n')
      if (newline < 0) return
      output = output.slice(newline + 1); this.discardPartialLine = false
    }
    const combined = this.remainder + output
    const boundary = combined.lastIndexOf('\n')
    const tail = combined.slice(boundary + 1)
    this.discardPartialLine = tail.length > 8192
    this.remainder = this.discardPartialLine ? '' : tail
    if (boundary < 0) return
    const clean = combined.slice(0, boundary + 1).split('\n').filter(line => line.length <= 8192).join('\n').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    if (/^\s*(?:sudo\s+)?systemctl\b/.test(command)) this.addMany('systemd', [...clean.matchAll(/\b([A-Za-z0-9@_.-]+\.(?:service|socket|timer|mount|target))\b/g)].map((match) => match[1]!))
    if (/^\s*docker\s+(?:ps|container\s+ls)\b/.test(command)) this.addMany('docker', dataLines(clean).map((line) => line.trim().split(/\s+/).at(-1) ?? ''))
    if (/^\s*kubectl\s+get\s+pods?\b/.test(command)) {
      const allNamespaces = /\s(?:-A|--all-namespaces)(?:\s|$)/.test(command)
      const namespace = command.match(/(?:^|\s)(?:-n|--namespace)(?:=|\s+)([A-Za-z0-9_.-]+)/)?.[1]
      for (const line of dataLines(clean)) {
        const columns = line.trim().split(/\s+/)
        const pod = columns[allNamespaces ? 1 : 0] ?? ''
        const ns = allNamespaces ? columns[0] : namespace
        if (!SAFE_ENTITY.test(pod) || (ns && !SAFE_ENTITY.test(ns))) continue
        const identity = ns ? `${ns}/${pod}` : pod
        this.addMany('kubernetes', [identity])
        if (ns) this.podNamespaces.set(identity, ns)
      }
      const pods = this.entities.get('kubernetes')
      for (const identity of this.podNamespaces.keys()) if (!pods?.has(identity)) this.podNamespaces.delete(identity)
    }
    if (/^\s*git\s+(?:branch|status)\b/.test(command)) this.addMany('git', [...clean.matchAll(/^\s*\*?\s*([A-Za-z0-9][A-Za-z0-9._/-]*)\s*$/gm)].map((match) => match[1]!))
  }

  suggest(line: string, limit = 6): TerminalCompletion[] {
    const route = entityRoute(line)
    if (!route) return []
    const prefix = route.prefix.toLowerCase()
    return [...(this.entities.get(route.kind)?.entries() ?? [])]
      .filter(([value]) => (route.kind === 'kubernetes' ? value.split('/').at(-1)! : value).toLowerCase().startsWith(prefix))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([value]) => ({ value: `${route.linePrefix}${route.kind === 'kubernetes' ? value.split('/').at(-1)! : value}${route.kind === 'kubernetes' && this.podNamespaces.has(value) ? ` -n ${this.podNamespaces.get(value)}` : ''}`, descriptionKey: 'terminal.autocomplete.descriptions.sessionEntity', source: 'command', resourceType: 'command', contextLabel: route.label, persistable: false }))
  }

  clear() { this.entities.clear(); this.podNamespaces.clear(); this.remainder = ''; this.discardPartialLine = false; this.command = '' }
  private addMany(kind: EntityKind, values: string[]) {
    const bucket = this.entities.get(kind) ?? new Map<string, number>()
    for (const value of values) if (SAFE_ENTITY.test(value) && !/^(?:name|names|status|ready|namespace)$/i.test(value)) bucket.set(value, (bucket.get(value) ?? 0) + 1)
    while (bucket.size > MAX_PER_KIND) bucket.delete(bucket.keys().next().value!)
    this.entities.set(kind, bucket)
  }
}

function dataLines(output: string) { return output.split(/\r?\n/).filter((line) => line.trim() && !/^(?:NAME|CONTAINER ID|NAMESPACE)\b/i.test(line.trim())) }
function entityRoute(line: string): { kind: EntityKind; linePrefix: string; prefix: string; label: string } | null {
  const routes: Array<[RegExp, EntityKind, string]> = [
    [/^(.*\bsystemctl\s+(?:status|restart|stop|start)\s+)([^\s]*)$/, 'systemd', 'systemd · sessão'],
    [/^(.*\bdocker\s+(?:logs|inspect|exec(?:\s+-it)?)\s+)([^\s]*)$/, 'docker', 'Docker · sessão'],
    [/^(.*\bkubectl\s+(?:logs|describe\s+pod)\s+)([^\s]*)$/, 'kubernetes', 'Kubernetes · sessão'],
    [/^(.*\bgit\s+(?:checkout|switch)\s+)([^\s]*)$/, 'git', 'Git · sessão'],
  ]
  for (const [pattern, kind, label] of routes) { const match = line.match(pattern); if (match) return { kind, label, linePrefix: match[1]!, prefix: match[2]! } }
  return null
}
