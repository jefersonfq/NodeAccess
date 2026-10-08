import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { SaveTerminalHighlightTemplateSchema } from '@nodeaccess/shared'
import { createHighlightPreset, highlightPresets } from './terminal-highlight-presets'
import { compileHighlightRules, matchTerminalLine } from '../terminal/terminal-highlighter'

describe('highlight preset library', () => {
  for (const preset of highlightPresets) {
    it(`${preset.id}: valid independent drafts, positive and negative samples`, () => {
      const draft = createHighlightPreset(preset.id, randomUUID)
      expect(SaveTerminalHighlightTemplateSchema.safeParse({ ...draft, active: true, userIds: [], groupIds: [] }).success).toBe(true)
      const second = createHighlightPreset(preset.id, randomUUID)
      expect(new Set([...draft.rules, ...second.rules].map(rule => rule.id)).size).toBe(draft.rules.length * 2)
      preset.rules.forEach((source, index) => {
        const compiled = compileHighlightRules([draft.rules[index]])
        expect(matchTerminalLine(source.sample, compiled).length).toBeGreaterThan(0)
        expect(matchTerminalLine(source.negative, compiled)).toEqual([])
        expect(matchTerminalLine(source.sample.toUpperCase(), compiled).length).toBeGreaterThan(0)
      })
      draft.rules[0].pattern = 'CHANGED'
      expect(second.rules[0].pattern).toBe(preset.rules[0].pattern)
    })
  }
  it('rejects unknown model instead of silently applying a default', () => {
    expect(() => createHighlightPreset('missing', randomUUID)).toThrow('não encontrado')
  })
  it('does not treat 0% packet loss as failure and limits dense output', () => {
    const rules = createHighlightPreset('network', randomUUID).rules
    expect(matchTerminalLine('0% packet loss', compileHighlightRules(rules))).toEqual([])
    expect(matchTerminalLine('UP '.repeat(10000), compileHighlightRules(rules)).length).toBe(120)
  })
})
