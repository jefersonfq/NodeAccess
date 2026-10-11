import { describe, expect, it } from 'vitest'
import { SaveTerminalHighlightPreferenceSchema, SaveTerminalHighlightTemplateSchema } from './terminal-highlight.schema'

describe('terminal highlight schema', () => {
  it('defaults to no rules', () => {
    expect(SaveTerminalHighlightPreferenceSchema.parse({ enabled: true, rules: [] })).toEqual({ enabled: true, rules: [] })
  })

  it('defaults administrative assignments to empty user and group lists', () => {
    expect(SaveTerminalHighlightTemplateSchema.parse({ name: 'Operação', active: true, rules: [] })).toMatchObject({ userIds: [], groupIds: [] })
  })

  it('rejects more than forty rules and oversized patterns', () => {
    const base = { id: '08dff7ec-57a8-4b18-a44c-7ed30068f15d', name: 'Erro', pattern: 'ERROR', mode: 'literal', caseSensitive: false, wholeWord: true, foreground: 'red', background: null, bold: true, enabled: true, priority: 50 }
    expect(() => SaveTerminalHighlightPreferenceSchema.parse({ enabled: true, rules: Array.from({ length: 41 }, () => base) })).toThrow()
    expect(() => SaveTerminalHighlightPreferenceSchema.parse({ enabled: true, rules: [{ ...base, pattern: 'x'.repeat(161) }] })).toThrow()
  })
})
