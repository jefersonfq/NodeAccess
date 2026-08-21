import type { TerminalCompletion } from './terminal-autocomplete.service'

type EntityKind = 'systemd' | 'docker' | 'kubernetes' | 'git'
const MAX_PER_KIND = 128
const SAFE_ENTITY = /^[A-Za-z0-9][A-Za-z0-9@_.:/-]{0,127}$/

export class TerminalSessionEntityIndex {
  private entities = new Map<EntityKind, Map<string, number>>()

  observe(command: string, output: string) {
    const clean = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    if (/^\s*(?:sudo\s+)?systemctl\b/.test(command)) this.addMany('systemd', [...clean.matchAll(/\b([A-Za-z0-9@_.-]+\.(?:service|socket|timer|mount|target))\b/g)].map((match) => match[1]!))
    if (/^\s*docker\s+(?:ps|container\s+ls)\b/.test(command)) this.addMany('docker', dataLines(clean).map((line) => line.trim().split(/\s+/).at(-1) ?? ''))
    if (/^\s*kubectl\s+get\s+(?:pods?|deployments?|services?)\b/.test(command)) this.addMany('kubernetes', dataLines(clean).flatMap((line) => {
      const columns = line.trim().split(/\s+/); return /\s-A(?:\s|$)/.test(command) ? columns.slice(0, 2) : columns.slice(0, 1)
    }))
    if (/^\s*git\s+(?:branch|status)\b/.test(command)) this.addMany('git', [...clean.matchAll(/^\s*\*?\s*([A-Za-z0-9][A-Za-z0-9._/-]*)\s*$/gm)].map((match) => match[1]!))
  }

  suggest(line: string, limit = 6): TerminalCompletion[] {
    const route = entityRoute(line)
    if (!route) return []
    const prefix = route.prefix.toLowerCase()
    return [...(this.entities.get(route.kind)?.entries() ?? [])]
      .filter(([value]) => value.toLowerCase().startsWith(prefix))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([value]) => ({ value: `${route.linePrefix}${value}`, descriptionKey: 'terminal.autocomplete.descriptions.sessionEntity', source: 'command', resourceType: 'command', contextLabel: route.label, persistable: false }))
  }

  clear() { this.entities.clear() }
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
