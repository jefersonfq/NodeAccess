import type { TerminalHighlightRule, TerminalHighlightTelemetryDto } from '@nodeaccess/shared'
import type { TerminalAdapter, TerminalHighlightRange } from './types.js'

const COLORS = { red: '#f87171', amber: '#fbbf24', orange: '#fb923c', green: '#4ade80', blue: '#60a5fa', cyan: '#22d3ee', purple: '#c084fc', gray: '#cbd5e1' } as const
export type RuntimeHighlightRule = TerminalHighlightRule & { templateId?: number | null }
type CompiledRule = { rule: RuntimeHighlightRule; regex: RegExp }

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function compileHighlightRules(rules: RuntimeHighlightRule[]): CompiledRule[] {
  return rules.filter((rule) => rule.enabled).slice(0, 40).flatMap((rule) => {
    try {
      let source = rule.mode === 'regex' ? rule.pattern : escapeRegex(rule.pattern)
      if (rule.mode === 'wildcard') source = source.replace(/\\\*/g, '.*?').replace(/\\\?/g, '.')
      if (rule.wholeWord) source = `\\b(?:${source})\\b`
      return [{ rule, regex: new RegExp(source, rule.caseSensitive ? 'gu' : 'giu') }]
    } catch { return [] }
  })
}

export function matchTerminalLine(line: string, compiled: CompiledRule[], maxMatches = 120, matchedRuleIds?: Set<string>): TerminalHighlightRange[] {
  const ranges: TerminalHighlightRange[] = []
  const occupied = new Set<number>()
  for (const { rule, regex } of compiled) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(line)) && ranges.length < maxMatches) {
      const text = match[0]
      if (!text) { regex.lastIndex += 1; continue }
      const start = match.index
      if (!Array.from({ length: text.length }).some((_, offset) => occupied.has(start + offset))) {
        for (let offset = 0; offset < text.length; offset += 1) occupied.add(start + offset)
        ranges.push({ x: start, width: text.length, foreground: COLORS[rule.foreground], background: rule.background ? COLORS[rule.background] : undefined, bold: rule.bold })
        matchedRuleIds?.add(rule.id)
      }
    }
    if (ranges.length >= maxMatches) break
  }
  return ranges
}

export class TerminalHighlighter {
  private compiled: CompiledRule[] = []
  private scheduled = false
  private disposed = false
  private bytesPending = 0
  private templateIds: number[] = []

  constructor(private readonly terminal: TerminalAdapter, private readonly onTelemetry: (sample: TerminalHighlightTelemetryDto) => void, private readonly budgetMs = 8, private readonly maxMatches = 120) {}

  setRules(rules: RuntimeHighlightRule[]): void {
    this.compiled = compileHighlightRules(rules)
    this.templateIds = [...new Set(rules.flatMap((rule) => rule.templateId ? [rule.templateId] : []))]
    this.terminal.clearHighlights()
  }

  schedule(bytes: number): void {
    if (this.disposed || !this.compiled.length || this.terminal.isAlternateBuffer) return
    this.bytesPending += bytes
    if (this.scheduled) return
    this.scheduled = true
    requestAnimationFrame(() => this.run())
  }

  private run(): void {
    this.scheduled = false
    if (this.disposed || this.terminal.isAlternateBuffer) return
    const started = performance.now()
    let matches = 0
    const matchedRuleIds = new Set<string>()
    const startLine = Math.max(0, this.terminal.cursorLine - 4)
    const endLine = Math.min(this.terminal.bufferLength, this.terminal.cursorLine + 1)
    for (let line = startLine; line < endLine; line += 1) {
      const text = this.terminal.getBufferLine(line) ?? ''
      const ranges = matchTerminalLine(text, this.compiled, this.maxMatches - matches, matchedRuleIds)
      matches += ranges.length
      this.terminal.setLineHighlights(line, ranges)
      if (matches >= this.maxMatches || performance.now() - started > this.budgetMs) break
    }
    const durationMs = performance.now() - started
    const sample = { templateIds: this.templateIds, matchedRuleIds: [...matchedRuleIds], durationMs, bytesProcessed: this.bytesPending, matchCount: matches, ruleCount: this.compiled.length, budgetExceeded: durationMs > this.budgetMs }
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nodeaccess:terminal-highlight-pass', { detail: sample }))
    this.bytesPending = 0
    if (durationMs >= 4 || sample.budgetExceeded) this.onTelemetry(sample)
  }

  dispose(): void { this.disposed = true; this.terminal.clearHighlights() }
}
