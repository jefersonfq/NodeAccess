import { suggestTerminalCompletions, type TerminalCompletion } from './terminal-autocomplete.service'
import { suggestContextualTerminalCompletions } from './terminal-contextual-autocomplete.service'

export function suggestPremiumTerminalCompletions(input: { line: string; recentValues?: readonly string[]; dynamicItems?: readonly TerminalCompletion[]; limit?: number }): TerminalCompletion[] {
  const limit = input.limit ?? 8
  const recent = input.recentValues ?? []
  const candidates = [
    ...(input.dynamicItems ?? []),
    ...suggestContextualTerminalCompletions(input.line, limit),
    ...suggestTerminalCompletions(input.line, limit, recent),
  ]
  return candidates
    .filter((item, index, all) => all.findIndex((candidate) => candidate.value === item.value) === index)
    .sort((a, b) => rank(a, input.line, recent) - rank(b, input.line, recent) || a.value.localeCompare(b.value))
    .slice(0, limit)
}

function rank(item: TerminalCompletion, line: string, recent: readonly string[]) {
  const value = item.value.toLowerCase(), query = line.toLowerCase()
  const exactPrefix = value.startsWith(query) ? 0 : 20
  const contextual = item.contextLabel ? -4 : 0
  const recentIndex = recent.indexOf(item.value)
  return exactPrefix + contextual + (recentIndex < 0 ? 12 : recentIndex)
}
