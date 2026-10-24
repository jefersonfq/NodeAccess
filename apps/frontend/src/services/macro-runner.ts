import { MacroSchema, type MacroStep } from '@nodeaccess/shared'
import type { MacroMatcher } from './macro-regex.service'

export type MacroStatus = 'running' | 'completed' | 'cancelled' | 'failed'
export interface MacroProgress { index: number; total: number; status: MacroStatus; error?: string }

/** Streaming normalization: escape sequences may span WebSocket frames. */
export class MacroOutput {
  private state: 'text' | 'esc' | 'csi' | 'osc' | 'oscEsc' = 'text'
  private cr = false
  clean(chunk: string, previous = ''): string {
    let out = previous
    for (const char of chunk) {
      if (this.state === 'oscEsc') { this.state = char === '\\' ? 'text' : 'osc'; continue }
      if (this.state === 'osc') { if (char === '\x07') this.state = 'text'; else if (char === '\x1b') this.state = 'oscEsc'; continue }
      if (this.state === 'csi') { if (char >= '@' && char <= '~') this.state = 'text'; continue }
      if (this.state === 'esc') { this.state = char === '[' ? 'csi' : char === ']' ? 'osc' : 'text'; continue }
      if (char === '\x1b') { this.state = 'esc'; continue }
      if (char === '\r') { out += '\n'; this.cr = true; continue }
      if (char === '\n' && this.cr) { this.cr = false; continue }
      this.cr = false
      if (char === '\b') { out = out.slice(0, -1); continue }
      if (char === '\n' || char === '\t' || char >= ' ') out += char
    }
    return out
  }
}

export class MacroRunner {
  private controller = new AbortController()
  private buffer = ''
  private base = 0
  private revision = 0
  private notify: (() => void) | null = null
  private output = new MacroOutput()
  private started = false
  private status: MacroStatus = 'running'
  private index = 0
  constructor(
    private readonly steps: MacroStep[],
    private readonly send: (text: string) => void,
    private readonly match: MacroMatcher,
    private readonly changed: (state: MacroProgress) => void,
  ) {}
  push(chunk: string): void {
    if (this.status !== 'running') return
    this.buffer = this.output.clean(chunk, this.buffer)
    if (this.buffer.length > 8192) { this.base += this.buffer.length - 8192; this.buffer = this.buffer.slice(-8192) }
    this.revision++
    this.notify?.()
  }
  cancel(): void { this.controller.abort(); this.notify?.() }
  private check(): void { if (this.controller.signal.aborted) throw new Error('cancelled') }
  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => { clearTimeout(timer); reject(new Error('cancelled')) }
      const timer = setTimeout(() => { this.controller.signal.removeEventListener('abort', abort); resolve() }, ms)
      this.controller.signal.addEventListener('abort', abort, { once: true })
      if (this.controller.signal.aborted) abort()
    })
  }
  private async wait(step: Extract<MacroStep, { type: 'wait' }>): Promise<void> {
    const started = Date.now()
    while (true) {
      this.check()
      const rev = this.revision
      const base = this.base
      const snapshot = this.buffer
      const haystack = step.caseSensitive ? snapshot : snapshot.toLowerCase()
      const needle = step.caseSensitive ? step.pattern : step.pattern.toLowerCase()
      const index = step.mode === 'literal' ? haystack.indexOf(needle) : -1
      const end = step.mode === 'regex'
        ? await this.match(step.pattern, snapshot, step.caseSensitive, this.controller.signal)
        : index < 0 ? null : index + step.pattern.length
      this.check()
      if (Date.now() - started >= step.timeoutMs) throw new Error('timeout')
      if (end !== null && base === this.base && this.buffer.startsWith(snapshot)) {
        this.buffer = this.buffer.slice(end)
        this.base += end
        return
      }
      if (rev !== this.revision) continue
      const remaining = step.timeoutMs - (Date.now() - started)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.max(1, remaining))
        const signal = this.controller.signal
        function done(): void { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
        this.notify = done
        signal.addEventListener('abort', done, { once: true })
        if (signal.aborted) done()
      })
      this.notify = null
    }
  }
  async run(): Promise<MacroProgress> {
    if (this.started) throw new Error('alreadyStarted')
    this.started = true
    let error: string | undefined
    try {
      MacroSchema.parse({ version: 1, steps: this.steps })
      for (const step of this.steps) {
        this.check()
        if (step.type === 'wait' && step.mode === 'regex') await this.match(step.pattern, '', step.caseSensitive, this.controller.signal)
      }
      for (this.index = 0; this.index < this.steps.length; this.index++) {
        this.check()
        this.changed({ index: this.index, total: this.steps.length, status: 'running' })
        const step = this.steps[this.index]
        if (step.type === 'wait') await this.wait(step)
        else if (step.type === 'pause') await this.delay(step.durationMs)
        else {
          // New send starts a new response boundary; never match earlier output.
          this.base += this.buffer.length
          this.buffer = ''
          const text = step.type === 'key' ? { ENTER: '\r', TAB: '\t', ESC: '\x1b' }[step.key] : step.text + (step.enter && !/[\r\n]$/.test(step.text) ? '\n' : '')
          this.send(text)
        }
      }
      this.check()
      this.status = 'completed'
    } catch (cause) {
      this.status = this.controller.signal.aborted ? 'cancelled' : 'failed'
      error = this.status === 'cancelled' ? 'cancelled' : cause instanceof Error && ['timeout', 'regexBudget', 'invalidRegex', 'disconnected'].includes(cause.message) ? cause.message : 'invalidSteps'
    }
    const result: MacroProgress = { index: this.index, total: this.steps.length, status: this.status, ...(error ? { error } : {}) }
    this.changed(result)
    return result
  }
}
