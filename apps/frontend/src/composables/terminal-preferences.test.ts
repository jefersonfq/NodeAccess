import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const renderer = vi.hoisted(() => ({ loaded: vi.fn() }))
vi.mock('@/terminal/xterm-adapter', () => {
  renderer.loaded()
  return { createXtermAdapter: vi.fn() }
})
vi.mock('@/stores/auth', () => ({ useAuthStore: vi.fn() }))
vi.mock('@/services/auth-session.service', () => ({ handleExpiredSession: vi.fn() }))
vi.mock('@/services/terminal-highlight.service', () => ({ terminalHighlightService: {} }))
vi.mock('@/services/app-events.service', () => ({ TERMINAL_HIGHLIGHTS_CHANGED_EVENT: 'nodeaccess:terminal-highlights-changed' }))

let storage: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
  })
  vi.stubGlobal('navigator', { platform: 'Linux', userAgent: 'test' })
})
afterEach(() => vi.unstubAllGlobals())

it('loads preferences without the renderer and shares the same state through legacy exports', async () => {
  const preferences = await import('./terminal-preferences')
  expect(renderer.loaded).not.toHaveBeenCalled()
  const terminal = await import('./useTerminal')
  expect(renderer.loaded).toHaveBeenCalledOnce()
  expect(terminal.termSettings).toBe(preferences.termSettings)
  expect(terminal.setFontSize).toBe(preferences.setFontSize)
  expect(terminal.applyTerminalPreferenceSnapshot).toBe(preferences.applyTerminalPreferenceSnapshot)
  preferences.setFontSize(18)
  expect(terminal.termSettings.fontSize).toBe(18)
  terminal.setShowTerminalToolbar(false)
  expect(preferences.termSettings.showTerminalToolbar).toBe(false)
  expect(storage.get('na_term_showToolbar')).toBe('0')
})

it('keeps stored settings and clamps font setters without losing persistence', async () => {
  storage.set('na_term_fontSize', '19')
  storage.set('na_term_theme', 'dracula')
  storage.set('na_term_showToolbar', '0')
  const preferences = await import('./terminal-preferences')
  expect(preferences.termSettings.fontSize).toBe(19)
  expect(preferences.termSettings.theme).toBe('dracula')
  expect(preferences.termSettings.showTerminalToolbar).toBe(false)
  preferences.setFontSize(100)
  expect(preferences.termSettings.fontSize).toBe(24)
  preferences.setFontSize(1)
  expect(preferences.termSettings.fontSize).toBe(10)
  expect(storage.get('na_term_fontSize')).toBe('10')
  expect(storage.get('na_term_preset')).toBe('custom')
})

it('round trips remote preference snapshots and restores platform defaults', async () => {
  const preferences = await import('./terminal-preferences')
  const snapshot = {
    ...preferences.getTerminalPreferenceSnapshot('ctrl-space', 'disabled'),
    fontSize: 17,
    theme: 'dracula' as const,
    showTerminalToolbar: false,
    middleClickPasteEnabled: false,
    graphicalOpenMode: 'dedicated' as const,
    sidebarRailPosition: 'left' as const,
    autocompleteEnabled: false,
    aiAssistantEnabled: false,
  }
  preferences.applyTerminalPreferenceSnapshot(snapshot)
  expect(preferences.getTerminalPreferenceSnapshot('ctrl-space', 'disabled')).toEqual(snapshot)
  expect(storage.get('na_term_theme')).toBe('dracula')
  expect(storage.get('na_term_middleClickPasteEnabled')).toBe('0')
  expect(storage.get('na_term_sidebarRailPosition')).toBe('left')
  preferences.resetTerminalPreferences()
  expect(preferences.termSettings).toMatchObject({
    preset: 'auto', fontSize: 13, theme: 'nord', showTerminalToolbar: true,
    middleClickPasteEnabled: true, sidebarRailPosition: 'right',
    autocompleteEnabled: true, aiAssistantEnabled: true,
  })
  expect(storage.get('na_term_showToolbar')).toBe('1')
})
