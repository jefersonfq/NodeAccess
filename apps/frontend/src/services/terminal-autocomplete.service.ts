export interface TerminalCompletion {
  value: string
  descriptionKey: string
  aliases?: string[]
  source?: 'command' | 'path' | 'snippet' | 'ai'
}

const COMPLETIONS: TerminalCompletion[] = [
  { value: 'cd ', descriptionKey: 'terminal.autocomplete.descriptions.cd', aliases: ['directory', 'folder', 'diretorio', 'pasta'] },
  { value: 'cd ..', descriptionKey: 'terminal.autocomplete.descriptions.cd', aliases: ['parent', 'acima', 'voltar'] },
  { value: 'cd -', descriptionKey: 'terminal.autocomplete.descriptions.cd', aliases: ['previous', 'anterior'] },
  { value: 'vim ', descriptionKey: 'terminal.autocomplete.descriptions.vim', aliases: ['edit', 'editor', 'arquivo'] },
  { value: 'ls -lah', descriptionKey: 'terminal.autocomplete.descriptions.ls' },
  { value: 'pwd', descriptionKey: 'terminal.autocomplete.descriptions.pwd' },
  { value: 'df -h', descriptionKey: 'terminal.autocomplete.descriptions.df' },
  { value: 'free -h', descriptionKey: 'terminal.autocomplete.descriptions.free' },
  { value: 'uptime', descriptionKey: 'terminal.autocomplete.descriptions.uptime' },
  { value: 'ps aux --sort=-%cpu | head', descriptionKey: 'terminal.autocomplete.descriptions.ps' },
  { value: 'systemctl status ', descriptionKey: 'terminal.autocomplete.descriptions.systemctl' },
  { value: 'journalctl -u ', descriptionKey: 'terminal.autocomplete.descriptions.journalctl' },
  { value: 'ss -lntp', descriptionKey: 'terminal.autocomplete.descriptions.ss' },
  { value: 'find ', descriptionKey: 'terminal.autocomplete.descriptions.find' },
  { value: 'du -xh --max-depth=1 | sort -h', descriptionKey: 'terminal.autocomplete.descriptions.df', aliases: ['disk', 'disco', 'space', 'espaco'] },
  { value: 'ip -br address', descriptionKey: 'terminal.autocomplete.descriptions.ss', aliases: ['network', 'rede', 'ip'] },
  { value: 'systemctl --failed', descriptionKey: 'terminal.autocomplete.descriptions.systemctl', aliases: ['failed', 'falha', 'services', 'servicos'] },
]

export function suggestTerminalCompletions(query: string, limit = 8, recentValues: readonly string[] = []): TerminalCompletion[] {
  const normalized = query.trim().toLowerCase()
  const terms = normalized.split(/\s+/).filter(Boolean)
  const ranked = COMPLETIONS.map((item, index) => ({
    item,
    index,
    score: scoreCompletion(item, terms),
    recentRank: recentValues.indexOf(item.value),
  })).filter((entry) => Number.isFinite(entry.score))
  ranked.sort((a, b) => a.score - b.score || rankRecent(a.recentRank) - rankRecent(b.recentRank) || a.index - b.index)
  return ranked.slice(0, Math.max(1, limit)).map((entry) => ({ ...entry.item, source: entry.item.source ?? 'command' }))
}

function rankRecent(index: number) { return index < 0 ? Number.MAX_SAFE_INTEGER : index }

function scoreCompletion(item: TerminalCompletion, terms: string[]) {
  if (!terms.length) return 2
  const value = item.value.toLowerCase()
  const aliases = item.aliases ?? []
  if (value.startsWith(terms.join(' '))) return 0
  if (terms.every((term) => value.includes(term))) return 1
  if (terms.every((term) => aliases.some((alias) => alias.includes(term)))) return 2
  return Number.POSITIVE_INFINITY
}

export function isTerminalAutocompleteShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) {
  return event.key === ' ' && event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}

/** Returns terminal bytes that complete or safely replace the current readline buffer. */
export function terminalCompletionInsertion(query: string, completion: string): string {
  if (completion.toLowerCase().startsWith(query.toLowerCase())) return completion.slice(query.length)
  return `\u0015${completion}`
}

export function terminalCompletionDisplayParts(query: string, completion: string) {
  if (!query || !completion.toLowerCase().startsWith(query.toLowerCase())) return { matched: '', remainder: completion }
  return { matched: completion.slice(0, query.length), remainder: completion.slice(query.length) }
}
