import { describe, expect, it } from 'vitest'
import { PatchUserPreferencesSchema, UserPreferencesSchema } from './user-preferences.schema.js'

const minimalPreferences = {
  ui: { themeMode: 'dark' },
  terminal: {
    preset: 'auto',
    fontSize: 14,
    fontFamily: 'monospace',
    theme: 'dark',
    rightClickMode: 'paste',
    multilinePasteMode: 'always',
  },
  hosts: {
    displayMode: 'cards',
    favoriteHostIds: [],
    recentHostIds: [],
  },
}

describe('terminal display mode preferences', () => {
  it('uses workspace as the operational default', () => {
    const preferences = UserPreferencesSchema.parse(minimalPreferences)
    expect(preferences.ui.terminalDisplayMode).toBe('workspace')
    expect(preferences.terminal.middleClickPasteEnabled).toBe(true)
  })

  it('allows users to disable middle-click paste', () => {
    const patch = PatchUserPreferencesSchema.parse({ terminal: { middleClickPasteEnabled: false } })
    expect(patch.terminal?.middleClickPasteEnabled).toBe(false)
  })

  it.each(['standard', 'workspace', 'sessions', 'focus'] as const)('accepts %s', (terminalDisplayMode) => {
    const patch = PatchUserPreferencesSchema.parse({ ui: { terminalDisplayMode } })
    expect(patch.ui?.terminalDisplayMode).toBe(terminalDisplayMode)
  })

  it('rejects unknown display modes', () => {
    expect(() => PatchUserPreferencesSchema.parse({ ui: { terminalDisplayMode: 'fullscreen' } })).toThrow()
  })
})
