import type { TerminalHighlightTelemetryDto } from '@nodeaccess/shared'
import type { TerminalAdapter } from './types.js'
import { createHighlightClient, HighlightError, highlightErrorMessage, type HighlightClient } from './terminal-highlight-client'
import type { RuntimeHighlightRule } from './terminal-highlight-engine'
// Pure functions remain available to existing unit contracts; production consumers use the client.
export { compileHighlightRules, matchTerminalLine } from './terminal-highlight-engine'
export type { RuntimeHighlightRule } from './terminal-highlight-engine'

export class TerminalHighlighter {
  private rules: RuntimeHighlightRule[] = []
  private scheduled = false
  private running = false
  private disposed = false
  private paused = false
  private revision = 0
  private bytesPending = 0
  private templateIds: number[] = []
  constructor(private readonly terminal: TerminalAdapter, private readonly onTelemetry: (sample: TerminalHighlightTelemetryDto) => void, private readonly budgetMs = 8, private readonly maxMatches = 120,
    private readonly client: Pick<HighlightClient, 'run' | 'cancel' | 'dispose'> = createHighlightClient(), private readonly onStatus: (message: string) => void = () => {}) {}
  setRules(rules: RuntimeHighlightRule[]): void {
    this.revision++; this.client.cancel(); this.paused = false; this.onStatus('')
    this.rules = rules.filter(rule => rule.enabled).slice(0, 40)
    this.templateIds = [...new Set(rules.flatMap(rule => rule.templateId ? [rule.templateId] : []))]
    this.terminal.clearHighlights()
  }
  schedule(bytes: number): void {
    if (this.disposed || this.paused || !this.rules.length || this.terminal.isAlternateBuffer) return
    this.bytesPending += bytes
    if (this.scheduled || this.running) return
    this.scheduled = true
    requestAnimationFrame(() => { void this.run() })
  }
  private async run(): Promise<void> {
    this.scheduled = false
    if (this.disposed || this.paused || !this.rules.length || this.terminal.isAlternateBuffer) return
    this.running = true
    const revision = this.revision
    const bytes = this.bytesPending; this.bytesPending = 0
    let durationMs = 0, matches = 0
    const matchedRuleIds = new Set<string>()
    try {
      const startLine = Math.max(0, this.terminal.cursorLine - 4)
      const endLine = Math.min(this.terminal.bufferLength, this.terminal.cursorLine + 1)
      for (let line = startLine; line < endLine; line++) {
        const text = this.terminal.getBufferLine(line) ?? ''
        const result = await this.client.run({ rows: [{ key: String(line), text, rules: this.rules }], maxMatches: this.maxMatches - matches })
        if (this.disposed || revision !== this.revision || this.terminal.isAlternateBuffer) return
        // Output may have changed while the worker computed. Never decorate a different line.
        if ((this.terminal.getBufferLine(line) ?? '') !== text) continue
        const row = result.rows[0]
        if (!row) continue
        durationMs += result.durationMs
        matches += row.ranges.length
        Object.keys(row.counts).forEach(id => matchedRuleIds.add(id))
        this.terminal.setLineHighlights(line, row.ranges)
        if (matches >= this.maxMatches || durationMs > this.budgetMs) break
      }
      const sample = { templateIds: this.templateIds, matchedRuleIds: [...matchedRuleIds], durationMs, bytesProcessed: bytes, matchCount: matches, ruleCount: this.rules.length, budgetExceeded: durationMs > this.budgetMs }
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nodeaccess:terminal-highlight-pass', { detail: sample }))
      if (durationMs >= 4 || sample.budgetExceeded) this.onTelemetry(sample)
    } catch (error) {
      if (this.disposed || revision !== this.revision || error instanceof HighlightError && error.code === 'superseded') return
      this.paused = true; this.terminal.clearHighlights(); this.onStatus(highlightErrorMessage(error))
      this.onTelemetry({ templateIds: this.templateIds, matchedRuleIds: [], durationMs, bytesProcessed: bytes, matchCount: 0, ruleCount: this.rules.length, budgetExceeded: durationMs > this.budgetMs || error instanceof HighlightError && error.code === 'timeout' })
    } finally {
      this.running = false
      if (this.bytesPending && !this.disposed && !this.paused) this.schedule(0)
    }
  }
  dispose(): void { this.disposed = true; this.revision++; this.client.dispose(); this.terminal.clearHighlights() }
}
