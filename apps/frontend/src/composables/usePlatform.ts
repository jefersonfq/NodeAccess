import { computed, reactive, ref } from 'vue'
import type { ThemeName } from './useTerminal'
import type { HostSwitcherShortcutMode as PersistedHostSwitcherShortcutMode, SnippetShortcutMode as PersistedSnippetShortcutMode } from '@nodeaccess/shared'

export type Platform = 'macos' | 'windows' | 'linux'
export type PlatformPreset = 'auto' | Platform | 'custom'
export type SnippetShortcutMode = PersistedSnippetShortcutMode
export type HostSwitcherShortcutMode = PersistedHostSwitcherShortcutMode

const SNIPPET_SHORTCUT_KEY = 'na_term_snippetShortcutMode'
const HOST_SWITCHER_SHORTCUT_KEY = 'na_term_hostSwitcherShortcutMode'
export const snippetShortcutMode = ref<SnippetShortcutMode>(
  normalizeSnippetShortcutMode(localStorage.getItem(SNIPPET_SHORTCUT_KEY)),
)
export const hostSwitcherShortcutMode = ref<HostSwitcherShortcutMode>(
  normalizeHostSwitcherShortcutMode(localStorage.getItem(HOST_SWITCHER_SHORTCUT_KEY)),
)

function detectPlatform(): Platform {
  const value = navigator.platform || navigator.userAgent || ''
  if (/Mac|iPhone|iPad/i.test(value)) return 'macos'
  if (/Win/i.test(value)) return 'windows'
  return 'linux'
}

function normalizeSnippetShortcutMode(value: string | null): SnippetShortcutMode {
  if (value === 'ctrl-space' || value === 'disabled' || value === 'default') return value
  return 'default'
}

function normalizeHostSwitcherShortcutMode(value: string | null): HostSwitcherShortcutMode {
  if (value === 'disabled' || value === 'default') return value
  return 'default'
}

function getSnippetShortcutLabel(mode: SnippetShortcutMode, isMac: boolean): string {
  if (mode === 'ctrl-space') return isMac ? '⌃Space' : 'Ctrl+Space'
  if (mode === 'disabled') return '—'
  return isMac ? '⌘+Shift+S' : 'Ctrl+Shift+S'
}

function getHostSwitcherShortcutLabel(mode: HostSwitcherShortcutMode, isMac: boolean): string {
  if (mode === 'disabled') return '—'
  return isMac ? '⌘+Shift+H' : 'Ctrl+Shift+H'
}

export function setSnippetShortcutMode(mode: SnippetShortcutMode) {
  const normalized = normalizeSnippetShortcutMode(mode)
  snippetShortcutMode.value = normalized
  localStorage.setItem(SNIPPET_SHORTCUT_KEY, normalized)
}

export function resetSnippetShortcutMode() {
  setSnippetShortcutMode('default')
}

export function setHostSwitcherShortcutMode(mode: HostSwitcherShortcutMode) {
  const normalized = normalizeHostSwitcherShortcutMode(mode)
  hostSwitcherShortcutMode.value = normalized
  localStorage.setItem(HOST_SWITCHER_SHORTCUT_KEY, normalized)
}

export function resetHostSwitcherShortcutMode() {
  setHostSwitcherShortcutMode('default')
}

export function usePlatform() {
  const platform = detectPlatform()
  const isMac = platform === 'macos'

  const modKey = computed(() => (isMac ? '⌘' : 'Ctrl'))

  function formatShortcut(parts: string[]): string {
    return parts.join('+')
  }

  function mod(shortcut: string): string {
    return formatShortcut([modKey.value, shortcut])
  }

  function modShift(shortcut: string): string {
    return formatShortcut([modKey.value, 'Shift', shortcut])
  }

  const shortcuts = reactive({
    commandPalette: mod('K'),
    find: mod('F'),
    paste: mod('V'),
    files: mod('B'),
    refresh: mod('R'),
    upload: mod('U'),
    save: mod('S'),
    fontIncrease: modShift('='),
    fontDecrease: modShift('-'),
    get snippets() {
      return getSnippetShortcutLabel(snippetShortcutMode.value, isMac)
    },
    get hostSwitcher() {
      return getHostSwitcherShortcutLabel(hostSwitcherShortcutMode.value, isMac)
    },
  })

  function isSnippetShortcutEvent(e: KeyboardEvent): boolean {
    if (snippetShortcutMode.value === 'disabled') return false
    if (snippetShortcutMode.value === 'ctrl-space') {
      return e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === 'Space'
    }
    return (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && e.shiftKey && e.key.toLowerCase() === 's'
  }

  function isHostSwitcherShortcutEvent(e: KeyboardEvent): boolean {
    if (hostSwitcherShortcutMode.value === 'disabled') return false
    return (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'h'
  }

  return {
    platform,
    isMac,
    modKey,
    shortcuts,
    snippetShortcutMode,
    hostSwitcherShortcutMode,
    isSnippetShortcutEvent,
    isHostSwitcherShortcutEvent,
  }
}

export const snippetShortcutModeOptions = [
  { label: 'Default', value: 'default' as const },
  { label: 'Ctrl+Space', value: 'ctrl-space' as const },
  { label: 'Disabled', value: 'disabled' as const },
]

export const hostSwitcherShortcutModeOptions = [
  { label: 'Default', value: 'default' as const },
  { label: 'Disabled', value: 'disabled' as const },
]

export function getPlatformPresetDefaults(platform: Platform): {
  fontFamily: string
  fontSize: number
  theme: ThemeName
} {
  if (platform === 'macos') {
    return {
      fontFamily: 'Menlo, Monaco, "SF Mono", "Courier New", monospace',
      fontSize: 14,
      theme: 'tokyo-night',
    }
  }

  if (platform === 'windows') {
    return {
      fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
      fontSize: 14,
      theme: 'one-dark',
    }
  }

  return {
    fontFamily: '"DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace',
    fontSize: 13,
    theme: 'nord',
  }
}
