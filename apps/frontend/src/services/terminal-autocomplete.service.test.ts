import { describe, expect, it } from 'vitest'
import { isTerminalAutocompleteShortcut, suggestTerminalCompletions, terminalCompletionDisplayParts, terminalCompletionInsertion } from './terminal-autocomplete.service'

describe('terminal deterministic autocomplete', () => {
  it('ranks prefix matches without consulting an AI provider', () => {
    expect(suggestTerminalCompletions('vi')[0]?.value).toBe('vim ')
    expect(suggestTerminalCompletions('df')[0]?.value).toBe('df -h')
  })

  it('limits results and recognizes only Ctrl+Space', () => {
    expect(suggestTerminalCompletions('', 3)).toHaveLength(3)
    expect(isTerminalAutocompleteShortcut({ key: ' ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe(true)
    expect(isTerminalAutocompleteShortcut({ key: ' ', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe(false)
  })

  it('finds deterministic operational commands by localized aliases', () => {
    expect(suggestTerminalCompletions('disco')[0]?.value).toContain('du -xh')
    expect(suggestTerminalCompletions('rede')[0]?.value).toBe('ip -br address')
    expect(suggestTerminalCompletions('servicos falha')[0]?.value).toBe('systemctl --failed')
  })

  it('completes prefixes without duplicating bytes', () => {
    expect(terminalCompletionInsertion('pw', 'pwd')).toBe('d')
    expect(terminalCompletionInsertion('DF', 'df -h')).toBe(' -h')
    expect(terminalCompletionInsertion('pwd', 'pwd')).toBe('')
  })

  it('replaces an alias query through readline without executing it', () => {
    expect(terminalCompletionInsertion('disco', 'du -xh --max-depth=1 | sort -h')).toBe('\u0015du -xh --max-depth=1 | sort -h')
    expect(terminalCompletionInsertion('rede', 'ip -br address')).not.toContain('\r')
    expect(terminalCompletionInsertion('rede', 'ip -br address')).not.toContain('\n')
  })

  it('is deterministic, bounded and returns no fuzzy false positives', () => {
    expect(suggestTerminalCompletions('comando inexistente')).toEqual([])
    expect(suggestTerminalCompletions('s', 2)).toHaveLength(2)
    expect(suggestTerminalCompletions('s', 0)).toHaveLength(1)
    expect(suggestTerminalCompletions('df').map((item) => item.value)).toEqual(suggestTerminalCompletions('df').map((item) => item.value))
  })

  it('uses recent deterministic commands only as a tie breaker', () => {
    expect(suggestTerminalCompletions('s', 3, ['systemctl --failed']).map((item) => item.value)[0]).toBe('systemctl --failed')
    expect(suggestTerminalCompletions('df', 3, ['systemctl --failed'])[0]?.value).toBe('df -h')
  })

  it('separates the typed prefix from the completion remainder', () => {
    expect(terminalCompletionDisplayParts('pw', 'pwd')).toEqual({ matched: 'pw', remainder: 'd' })
    expect(terminalCompletionDisplayParts('disco', 'du -xh')).toEqual({ matched: '', remainder: 'du -xh' })
  })
})
