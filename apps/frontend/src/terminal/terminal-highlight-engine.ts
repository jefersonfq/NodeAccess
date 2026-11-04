import type { TerminalHighlightRule } from '@nodeaccess/shared'
import type { TerminalHighlightRange } from './types.js'

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
    while (ranges.length < maxMatches && (match = regex.exec(line))) {
      const text = match[0]
      if (!text) { regex.lastIndex += (line.codePointAt(regex.lastIndex) ?? 0) > 0xFFFF ? 2 : 1; continue }
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

export interface HighlightRow { key: string; text: string; rules: RuntimeHighlightRule[]; independent?: boolean }
export interface HighlightRequest { rows: HighlightRow[]; maxMatches?: number; softBudgetMs?: number }
export interface HighlightResultRow { key: string; ranges: TerminalHighlightRange[]; counts: Record<string, number> }
export interface HighlightResult { rows: HighlightResultRow[]; durationMs: number; budgetExceeded: boolean }

/** Only the worker executes this operation in production. Unit tests exercise the pure engine. */
export function evaluateHighlights(request: HighlightRequest): HighlightResult {
  const started = performance.now()
  const rows: HighlightResultRow[] = []
  let remaining = request.maxMatches ?? 120
  for (const input of request.rows) {
    const counts: Record<string, number> = {}
    let ranges: TerminalHighlightRange[] = []
    if (input.independent) {
      for (const rule of input.rules) counts[rule.id] = matchTerminalLine(input.text, compileHighlightRules([rule]), request.maxMatches ?? 120).length
    } else {
      const ids = new Set<string>()
      ranges = matchTerminalLine(input.text, compileHighlightRules(input.rules), remaining, ids)
      for (const id of ids) counts[id] = 1
      remaining -= ranges.length
    }
    rows.push({ key: input.key, ranges, counts })
    if (request.softBudgetMs !== undefined && (remaining <= 0 || performance.now() - started > request.softBudgetMs)) break
  }
  const durationMs = performance.now() - started
  return { rows, durationMs, budgetExceeded: durationMs > (request.softBudgetMs ?? 50) }
}
