import type { HighlightRequest, HighlightResult } from './terminal-highlight-engine'

export type HighlightFailure = 'timeout' | 'unavailable' | 'superseded' | 'disposed' | 'capacity' | 'input-limit' | 'failed'
export class HighlightError extends Error {
  constructor(readonly code: HighlightFailure) { super(`Highlight ${code}`) }
}
export interface HighlightWorker {
  postMessage(value: unknown): void
  terminate(): void
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
}
type Job = { id: number; owner: HighlightClient; config: string; request: HighlightRequest; resolve: (value: HighlightResult) => void; reject: (error: HighlightError) => void }

/** One worker per page, at most one pending request per owner and 32 pending owners. */
export class HighlightPool {
  private worker: HighlightWorker | null = null
  private ready = false
  private stopped: HighlightFailure | null = null
  private sequence = 0
  private active: Job | null = null
  private readonly queue = new Map<HighlightClient, Job>()
  private readonly owners = new Set<HighlightClient>()
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly factory: () => HighlightWorker, private readonly deadlineMs = 50, private readonly startupMs = 3000) {}
  client(): HighlightClient { const owner = new HighlightClient(this); this.owners.add(owner); return owner }
  request(owner: HighlightClient, request: HighlightRequest, config: string): Promise<HighlightResult> {
    if (this.stopped) return Promise.reject(new HighlightError(this.stopped))
    if (!validRequest(request)) return Promise.reject(new HighlightError('input-limit'))
    this.queue.get(owner)?.reject(new HighlightError('superseded'))
    this.queue.delete(owner)
    if (this.active?.owner === owner) this.active.reject(new HighlightError('superseded'))
    if (this.queue.size >= 32) return Promise.reject(new HighlightError('capacity'))
    return new Promise((resolve, reject) => {
      this.queue.set(owner, { id: ++this.sequence, owner, config, request: snapshotRequest(request), resolve, reject })
      this.pump()
    })
  }
  cancel(owner: HighlightClient): void {
    this.queue.get(owner)?.reject(new HighlightError('superseded'))
    this.queue.delete(owner)
    if (this.active?.owner === owner) {
      this.active.reject(new HighlightError('superseded'))
    }
    this.pump()
  }
  release(owner: HighlightClient): void {
    this.owners.delete(owner)
    this.cancel(owner)
    if (!this.owners.size && !this.active) this.stop()
  }
  private stop(): void {
    clearTimeout(this.timer)
    if (this.worker) {
      this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null
      this.worker.terminate()
    }
    this.worker = null; this.ready = false
  }
  private fail(code: HighlightFailure): void {
    const job = this.active
    this.active = null
    // terminate() can leave native code running until the browser forces shutdown.
    // Never create another worker after failure, even if every owner is disposed.
    this.stopped = code
    this.stop()
    if (job) { job.owner.quarantine(job.config, code); job.reject(new HighlightError(code)) }
    for (const pending of this.queue.values()) pending.reject(new HighlightError(code))
    this.queue.clear()
  }
  private pump(): void {
    if (this.active || !this.queue.size || this.stopped) return
    if (!this.worker) {
      try {
        const worker = this.factory()
        this.worker = worker
        worker.onmessage = (event: MessageEvent<{ ready?: boolean; id?: number; result?: HighlightResult; error?: boolean }>): void => {
          if (this.worker !== worker) return
          if (event.data.ready && !this.ready) { clearTimeout(this.timer); this.ready = true; this.pump(); return }
          const job = this.active
          if (!job || event.data.id !== job.id) return
          if (event.data.error || !event.data.result) { this.fail('failed'); return }
          clearTimeout(this.timer); this.active = null
          job.resolve(event.data.result)
          if (!this.owners.size) this.stop()
          else this.pump()
        }
        worker.onerror = (): void => this.fail(this.ready ? 'failed' : 'unavailable')
        worker.onmessageerror = (): void => this.fail('failed')
        this.timer = setTimeout(() => this.fail('unavailable'), this.startupMs)
      } catch { this.fail('unavailable') }
      return
    }
    if (!this.ready) return
    const next = this.queue.values().next().value
    if (!next) return
    this.queue.delete(next.owner)
    this.active = next
    this.timer = setTimeout(() => this.fail('timeout'), this.deadlineMs)
    try { this.worker.postMessage({ id: next.id, request: next.request }) }
    catch { this.fail('failed') }
  }
}

// Vue reactive proxies are not structured-cloneable. Copy only protocol primitives.
function snapshotRequest(request: HighlightRequest): HighlightRequest {
  return { maxMatches: request.maxMatches, softBudgetMs: request.softBudgetMs, rows: request.rows.map(row => ({ key: row.key, text: row.text, independent: row.independent,
    rules: row.rules.map(rule => ({ id: rule.id, name: rule.name, pattern: rule.pattern, mode: rule.mode, caseSensitive: rule.caseSensitive, wholeWord: rule.wholeWord, foreground: rule.foreground, background: rule.background, bold: rule.bold, enabled: rule.enabled, priority: rule.priority, templateId: rule.templateId })) })) }
}

function validRequest(request: HighlightRequest): boolean {
  if (request.rows.length > 40) return false
  let total = 0
  for (const row of request.rows) {
    total += row.text.length
    if (row.text.length > 65536 || row.rules.length > 40 || row.rules.some(rule => rule.pattern.length > 160)) return false
  }
  return total <= 262144 && (request.maxMatches === undefined || request.maxMatches > 0 && request.maxMatches <= 120)
}
export class HighlightClient {
  private disposed = false
  private blocked: { config: string; code: HighlightFailure } | null = null
  private config = ''
  private generation = 0
  constructor(private readonly pool: HighlightPool) {}
  quarantine(config: string, code: HighlightFailure): void { if (this.config === config) this.blocked = { config, code } }
  async run(request: HighlightRequest, config = JSON.stringify(request.rows.map(row => row.rules))): Promise<HighlightResult> {
    if (this.disposed) throw new HighlightError('disposed')
    if (config !== this.config) { this.config = config; this.blocked = null; this.pool.cancel(this) }
    if (this.blocked?.config === config) throw new HighlightError(this.blocked.code)
    const generation = ++this.generation
    const result = await this.pool.request(this, request, config)
    if (this.disposed || generation !== this.generation) throw new HighlightError('superseded')
    return result
  }
  cancel(): void { this.generation++; this.pool.cancel(this) }
  dispose(): void { this.disposed = true; this.generation++; this.pool.release(this) }
}
const sharedPool = new HighlightPool(() => new Worker(new URL('./terminal-highlight.worker.ts', import.meta.url), { type: 'module' }))
export function createHighlightClient(): HighlightClient { return sharedPool.client() }
export function highlightErrorMessage(error: unknown): string {
  if (error instanceof HighlightError && error.code === 'timeout') return 'Destaques pausados nesta página: uma regra excedeu o tempo de cálculo. Revise as regras, salve e recarregue a página.'
  if (error instanceof HighlightError && error.code === 'input-limit') return 'Este conteúdo excede o limite de análise dos destaques.'
  return 'Destaques indisponíveis nesta página. Salve seu trabalho e recarregue. O terminal continua disponível.'
}
