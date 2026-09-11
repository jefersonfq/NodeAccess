// Bounded, in-memory diagnostics; no usernames, commands, secrets or source IPs.
export class TacacsMetrics {
  private readonly pending = new Map<number, { started: number; tenantId?: number }>()
  private readonly tenants = new Map<number, { requests: number; errors: number; timeouts: number; durations: number[]; lastRequestAt: number }>()
  private nextId = 0
  begin() { const id = ++this.nextId; this.pending.set(id, { started: Date.now() }); return id }
  bind(id: number, tenantId: number) {
    const operation = this.pending.get(id)
    if (!operation) return
    operation.tenantId = tenantId
    if (!this.tenants.has(tenantId)) {
      if (this.tenants.size >= 1024) this.tenants.delete(this.tenants.keys().next().value!)
      this.tenants.set(tenantId, { requests: 0, errors: 0, timeouts: 0, durations: [], lastRequestAt: 0 })
    }
    const tenant = this.tenants.get(tenantId)!
    tenant.requests++; tenant.lastRequestAt = Date.now()
  }
  error(id: number) { const tenant = this.tenant(id); if (tenant) tenant.errors++ }
  timeout(id: number) { const tenant = this.tenant(id); if (tenant) tenant.timeouts++ }
  finish(id: number) {
    const operation = this.pending.get(id), tenant = this.tenant(id)
    if (operation && tenant) {
      tenant.durations.push(Math.max(0, Date.now() - operation.started))
      if (tenant.durations.length > 128) tenant.durations.shift()
    }
    this.pending.delete(id)
  }
  private tenant(id: number) { return this.tenants.get(this.pending.get(id)?.tenantId ?? -1) }
  snapshot() {
    const now = Date.now()
    const pending = [...this.pending.values()]
    return {
      pendingOperations: pending.length,
      oldestOperationMs: Math.max(0, ...pending.map(p => now - p.started)),
      tenants: Object.fromEntries([...this.tenants].map(([id, t]) => {
        const durations = [...t.durations].sort((a, b) => a - b)
        return [id, { requests: t.requests, errors: t.errors, timeouts: t.timeouts,
          lastRequestAt: t.lastRequestAt, pendingOperations: pending.filter(p => p.tenantId === id).length,
          p95Ms: durations.length ? durations[Math.ceil(durations.length * .95) - 1] : null }]
      })),
    }
  }
}
