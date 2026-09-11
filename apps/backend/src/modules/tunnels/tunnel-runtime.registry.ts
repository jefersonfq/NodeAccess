import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { AppError } from '../../shared/errors.js'
import { logger } from '../../config/logger.js'
import type { TunnelInfo } from './tunnel.service.js'

const LEASE_MS = 15000

/** Leased discovery plus acknowledged commands addressed to the owning process. */
export class TunnelRuntimeRegistry {
  readonly id = randomUUID()
  private get prefix() { return `${this.index}:` }
  private subscriber: Redis | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private stopped = false
  private writing: Promise<void> = Promise.resolve()
  private replies = new Map<string, (error?: AppError) => void>()
  constructor(private readonly redis: Redis,
    private readonly snapshot: () => TunnelInfo[],
    private readonly closeLocal: (id: string, userId: number, tenantId: number) => Promise<void>,
    private readonly index = 'nodeaccess:tunnels:runtimes',
  ) {}

  async start() {
    if (this.subscriber) return
    this.stopped = false
    const subscriber = this.redis.duplicate()
    subscriber.on('error', error => logger.warn({ error }, 'Tunnel runtime subscriber unavailable'))
    subscriber.on('message', (_channel, raw) => { void this.handle(raw).catch(error => logger.warn({ error }, 'Tunnel runtime command failed')) })
    await subscriber.connect()
    await subscriber.subscribe(this.prefix + this.id)
    this.subscriber = subscriber
    await this.publish()
    this.timer = setInterval(() => { void this.publish().catch(error => logger.warn({ error }, 'Tunnel runtime heartbeat failed')) }, 3000)
    this.timer.unref()
  }

  publish(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    // Serialize snapshots so a late OPEN cannot overwrite a subsequent CLOSE.
    this.writing = this.writing.catch(() => {}).then(async () => {
      const rows = this.snapshot().map(row => ({ ...row, runtimeId: this.id }))
      await this.redis.set(this.prefix + this.id + ':snapshot', JSON.stringify(rows), 'PX', LEASE_MS)
      await this.redis.zadd(this.index, Date.now() + LEASE_MS, this.id)
      await this.redis.zremrangebyscore(this.index, '-inf', Date.now() - 1)
    })
    return this.writing
  }

  async list(userId: number, tenantId: number): Promise<TunnelInfo[]> {
    try {
      const owners = await this.redis.zrangebyscore(this.index, Date.now(), '+inf')
      const snapshots = owners.length ? await this.redis.mget(...owners.map(id => this.prefix + id + ':snapshot')) : []
      const rows = snapshots.flatMap(raw => raw ? JSON.parse(raw) as TunnelInfo[] : [])
      // This process's live state is more recent than its last heartbeat.
      return [...rows.filter(row => row.runtimeId !== this.id), ...this.snapshot().map(row => ({ ...row, runtimeId: this.id }))]
        .filter(row => row.userId === userId && row.tenantId === tenantId)
    } catch {
      throw new AppError('Não foi possível consultar as instâncias de túneis. Tente novamente.', 503, 'TUNNEL_RUNTIME_UNAVAILABLE')
    }
  }

  async close(id: string, userId: number, tenantId: number, timeoutMs = 3000): Promise<void> {
    const tunnel = (await this.list(userId, tenantId)).find(row => row.id === id)
    if (!tunnel) throw new AppError('Túnel não encontrado', 404, 'TUNNEL_NOT_FOUND')
    if (tunnel.runtimeId === this.id) { await this.closeLocal(id, userId, tenantId); await this.publish(); return }
    if (!this.subscriber) throw new AppError('Controle de túneis indisponível', 503, 'TUNNEL_RUNTIME_UNAVAILABLE')
    const requestId = randomUUID()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new AppError('A instância do túnel não confirmou o encerramento. Atualize e tente novamente.', 503, 'TUNNEL_RUNTIME_TIMEOUT')), timeoutMs)
      const finish = (error?: AppError) => { clearTimeout(timer); this.replies.delete(requestId); error ? reject(error) : resolve() }
      this.replies.set(requestId, finish)
      void this.redis.publish(this.prefix + tunnel.runtimeId, JSON.stringify({ type: 'close', requestId, replyTo: this.id, id, userId, tenantId }))
        .catch(() => finish(new AppError('Controle de túneis indisponível', 503, 'TUNNEL_RUNTIME_UNAVAILABLE')))
    })
  }

  private async handle(raw: string) {
    let command: Record<string, unknown>
    try { command = JSON.parse(raw) } catch { return }
    if (!command || typeof command.requestId !== 'string') return
    if (command.type === 'reply') {
      this.replies.get(command.requestId)?.(command.ok === true ? undefined : new AppError('Não foi possível encerrar o túnel na instância responsável', 503, 'TUNNEL_RUNTIME_CLOSE_FAILED'))
      return
    }
    if (command.type !== 'close' || typeof command.id !== 'string' || typeof command.replyTo !== 'string'
      || !Number.isSafeInteger(command.userId) || !Number.isSafeInteger(command.tenantId)) return
    let ok = false
    try { await this.closeLocal(command.id, Number(command.userId), Number(command.tenantId)); await this.publish(); ok = true } catch { /* acknowledged failure */ }
    await this.redis.publish(this.prefix + command.replyTo, JSON.stringify({ type: 'reply', requestId: command.requestId, ok }))
  }

  async stop() {
    this.stopped = true
    clearInterval(this.timer)
    this.timer = undefined
    await this.writing.catch(() => {})
    await this.redis.zrem(this.index, this.id)
    await this.redis.del(this.prefix + this.id + ':snapshot')
    this.subscriber?.disconnect()
    this.subscriber = undefined
    for (const finish of this.replies.values()) finish(new AppError('Instância encerrando', 503, 'TUNNEL_RUNTIME_UNAVAILABLE'))
  }
}
