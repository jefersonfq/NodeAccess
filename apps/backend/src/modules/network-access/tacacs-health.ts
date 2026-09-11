import { Redis } from 'ioredis'
import type { createTacacsServer } from './tacacs-server.js'
export type RuntimeSnapshot = ReturnType<ReturnType<typeof createTacacsServer>['snapshot']>
export type Heartbeat = { observedAt: number; database: boolean; runtime: RuntimeSnapshot }
export const HEALTH_FRESH_MS = 20000
export function requiresSupervisorRestart(snapshot: RuntimeSnapshot, stallMs: number) {
  return snapshot.pendingOperations > 0 && snapshot.oldestOperationMs >= stallMs
}
export function operationalState(beat: Heartbeat, now = Date.now()) {
  if (beat.observedAt > now + 5000 || now - beat.observedAt > HEALTH_FRESH_MS) return 'stale' as const
  if (!beat.database || !beat.runtime.listening || beat.runtime.oldestOperationMs >= beat.runtime.limits.timeoutMs || beat.runtime.pendingOperations >= beat.runtime.limits.operations) return 'degraded' as const
  return 'ready' as const
}
export function tenantHealth(beats: Array<{ id: string; heartbeat: Heartbeat }>, tenantId: number, now = Date.now()) {
  const instances = beats.map(({ id, heartbeat }) => ({
    id, observedAt: heartbeat.observedAt, state: operationalState(heartbeat, now),
    database: heartbeat.database,
    activity: heartbeat.runtime.tenants[tenantId] ?? null,
  }))
  const status = !instances.length ? 'unobserved' : instances.every(i => i.state === 'ready') ? 'ready' : 'degraded'
  return { status, instances }
}
// Dedicated connection: diagnostics must not queue behind application Redis work.
export class TacacsHealthStore {
  private readonly redis: Redis
  private connecting: Promise<unknown> | undefined
  constructor(url: string, password?: string, private readonly prefix = 'na:tacacs:health:v1') {
    this.redis = new Redis(url, { password, lazyConnect: true, enableOfflineQueue: false,
      maxRetriesPerRequest: 0, commandTimeout: 1500, connectTimeout: 1500, retryStrategy: () => null })
    this.redis.on('error', () => {})
  }
  private async ready() {
    if (this.redis.status === 'ready') return
    if (!this.connecting) this.connecting = this.redis.connect().finally(() => { this.connecting = undefined })
    await this.connecting
  }
  async publish(id: string, heartbeat: Heartbeat) {
    await this.ready()
    await this.redis.set(`${this.prefix}:${id}`, JSON.stringify(heartbeat), 'EX', 60)
    await this.redis.zadd(this.prefix, heartbeat.observedAt, id)
    await this.redis.zremrangebyscore(this.prefix, '-inf', heartbeat.observedAt - 60000)
  }
  async read(tenantId: number) {
    await this.ready()
    const ids = await this.redis.zrangebyscore(this.prefix, Date.now() - 60000, '+inf', 'LIMIT', 0, 32)
    const values = await Promise.all(ids.map(id => this.redis.get(`${this.prefix}:${id}`)))
    const beats: Array<{ id: string; heartbeat: Heartbeat }> = []
    values.forEach((value, index) => { if (value) beats.push({ id: ids[index]!, heartbeat: JSON.parse(value) }) })
    return tenantHealth(beats, tenantId)
  }
  async remove(id: string) {
    await this.ready(); await this.redis.del(`${this.prefix}:${id}`); await this.redis.zrem(this.prefix, id)
  }
  close() { this.redis.disconnect() }
}
