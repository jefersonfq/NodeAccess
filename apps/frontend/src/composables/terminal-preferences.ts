import { reactive } from 'vue'
import { getPlatformPresetDefaults, usePlatform, type PlatformPreset } from './usePlatform'
import type {
  HostSwitcherShortcutMode,
  MultilinePasteMode as PersistedMultilinePasteMode,
  RightClickMode as PersistedRightClickMode,
  SnippetShortcutMode,
  TerminalPreset as PersistedTerminalPreset,
  TerminalThemeName,
  UserTerminalPreferences,
} from '@nodeaccess/shared'

export type ThemeName = TerminalThemeName
export type RightClickMode = PersistedRightClickMode
export type MultilinePasteMode = PersistedMultilinePasteMode
export type TerminalSidebarPosition = UserTerminalPreferences['sidebarRailPosition']
export type GraphicalOpenMode = UserTerminalPreferences['graphicalOpenMode']
export type TerminalPreferenceSnapshot = UserTerminalPreferences

// Preferences stay independent of the terminal renderer and its addons.
const FONT_KEY  = 'na_term_fontSize'
const THEME_KEY = 'na_term_theme'
const FONT_FAMILY_KEY = 'na_term_fontFamily'
const PRESET_KEY = 'na_term_preset'
const RIGHT_CLICK_KEY = 'na_term_rightClickMode'
const MULTILINE_PASTE_KEY = 'na_term_multilinePasteMode'
const MIDDLE_CLICK_PASTE_KEY = 'na_term_middleClickPasteEnabled'
const AUTO_FULLSCREEN_KEY  = 'na_term_autoFullscreenOnConnect'
const SHOW_TOOLBAR_KEY     = 'na_term_showToolbar'
const SIDEBAR_RAIL_POSITION_KEY = 'na_term_sidebarRailPosition'
const GRAPHICAL_OPEN_MODE_KEY = 'na_term_graphicalOpenMode'
const AUTOCOMPLETE_ENABLED_KEY = 'na_term_autocompleteEnabled'
const AI_ASSISTANT_ENABLED_KEY = 'na_term_aiAssistantEnabled'
const MIN_FONT  = 10
const MAX_FONT  = 24
function getPresetDefaults(preset: PlatformPreset, detectedPlatform: ReturnType<typeof usePlatform>['platform']) {
  return getPlatformPresetDefaults(preset === 'auto' || preset === 'custom' ? detectedPlatform : preset)
}

const detectedPlatform = usePlatform().platform
const savedPreset = (localStorage.getItem(PRESET_KEY) as PlatformPreset | null) ?? 'auto'
const initialPreset: PlatformPreset = ['auto', 'windows', 'linux', 'macos', 'custom'].includes(savedPreset) ? savedPreset : 'auto'
const initialDefaults = getPresetDefaults(initialPreset, detectedPlatform)

export const termSettings = reactive({
  preset: initialPreset,
  fontSize: Number(localStorage.getItem(FONT_KEY) ?? String(initialDefaults.fontSize)),
  fontFamily: localStorage.getItem(FONT_FAMILY_KEY) ?? initialDefaults.fontFamily,
  theme: (localStorage.getItem(THEME_KEY) ?? initialDefaults.theme) as ThemeName,
  rightClickMode: ((localStorage.getItem(RIGHT_CLICK_KEY) as RightClickMode | null) ?? 'paste') as RightClickMode,
  multilinePasteMode: ((localStorage.getItem(MULTILINE_PASTE_KEY) as MultilinePasteMode | null) ?? 'always') as MultilinePasteMode,
  middleClickPasteEnabled: localStorage.getItem(MIDDLE_CLICK_PASTE_KEY) !== '0',
  autoFullscreenOnConnect: localStorage.getItem(AUTO_FULLSCREEN_KEY) === '1',
  graphicalOpenMode: ((localStorage.getItem(GRAPHICAL_OPEN_MODE_KEY) as GraphicalOpenMode | null) ?? 'dedicated') as GraphicalOpenMode,
  showTerminalToolbar: localStorage.getItem(SHOW_TOOLBAR_KEY) !== '0',
  sidebarRailPosition: ((localStorage.getItem(SIDEBAR_RAIL_POSITION_KEY) as TerminalSidebarPosition | null) ?? 'right') as TerminalSidebarPosition,
  autocompleteEnabled: localStorage.getItem(AUTOCOMPLETE_ENABLED_KEY) !== '0',
  aiAssistantEnabled: localStorage.getItem(AI_ASSISTANT_ENABLED_KEY) !== '0',
})

export function setFontSize(size: number) {
  termSettings.preset = 'custom'
  termSettings.fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, size))
  localStorage.setItem(PRESET_KEY, termSettings.preset)
  localStorage.setItem(FONT_KEY, String(termSettings.fontSize))
}

export function setTheme(name: ThemeName) {
  termSettings.preset = 'custom'
  termSettings.theme = name
  localStorage.setItem(PRESET_KEY, termSettings.preset)
  localStorage.setItem(THEME_KEY, name)
}

export function setRightClickMode(mode: RightClickMode) {
  termSettings.rightClickMode = mode
  localStorage.setItem(RIGHT_CLICK_KEY, mode)
}

export function setMultilinePasteMode(mode: MultilinePasteMode) {
  termSettings.multilinePasteMode = mode
  localStorage.setItem(MULTILINE_PASTE_KEY, mode)
}

export function setMiddleClickPasteEnabled(value: boolean) {
  termSettings.middleClickPasteEnabled = value
  localStorage.setItem(MIDDLE_CLICK_PASTE_KEY, value ? '1' : '0')
}

export function setAutoFullscreenOnConnect(value: boolean) {
  termSettings.autoFullscreenOnConnect = value
  localStorage.setItem(AUTO_FULLSCREEN_KEY, value ? '1' : '0')
}

export function setGraphicalOpenMode(value: GraphicalOpenMode) {
  termSettings.graphicalOpenMode = value
  localStorage.setItem(GRAPHICAL_OPEN_MODE_KEY, value)
}

export function applyTerminalPreset(preset: PlatformPreset) {
  const defaults = getPresetDefaults(preset, detectedPlatform)
  termSettings.preset = preset
  termSettings.fontSize = defaults.fontSize
  termSettings.fontFamily = defaults.fontFamily
  termSettings.theme = defaults.theme
  localStorage.setItem(PRESET_KEY, preset)
  localStorage.setItem(FONT_KEY, String(termSettings.fontSize))
  localStorage.setItem(FONT_FAMILY_KEY, termSettings.fontFamily)
  localStorage.setItem(THEME_KEY, termSettings.theme)
}

export function setShowTerminalToolbar(value: boolean) {
  termSettings.showTerminalToolbar = value
  localStorage.setItem(SHOW_TOOLBAR_KEY, value ? '1' : '0')
}

export function setTerminalSidebarRailPosition(value: TerminalSidebarPosition) {
  termSettings.sidebarRailPosition = value
  localStorage.setItem(SIDEBAR_RAIL_POSITION_KEY, value)
}

export function setTerminalAutocompleteEnabled(value: boolean) {
  termSettings.autocompleteEnabled = value
  localStorage.setItem(AUTOCOMPLETE_ENABLED_KEY, value ? '1' : '0')
}

export function setTerminalAiAssistantEnabled(value: boolean) {
  termSettings.aiAssistantEnabled = value
  localStorage.setItem(AI_ASSISTANT_ENABLED_KEY, value ? '1' : '0')
}

export function resetTerminalPreferences() {
  applyTerminalPreset('auto')
  setRightClickMode('paste')
  setMultilinePasteMode('always')
  setMiddleClickPasteEnabled(true)
  setAutoFullscreenOnConnect(false)
  setGraphicalOpenMode('dedicated')
  setShowTerminalToolbar(true)
  setTerminalSidebarRailPosition('right')
  setTerminalAutocompleteEnabled(true)
  setTerminalAiAssistantEnabled(true)
}

export function applyTerminalPreferenceSnapshot(snapshot: TerminalPreferenceSnapshot) {
  termSettings.preset = snapshot.preset
  termSettings.fontSize = snapshot.fontSize
  termSettings.fontFamily = snapshot.fontFamily
  termSettings.theme = snapshot.theme
  termSettings.rightClickMode = snapshot.rightClickMode
  termSettings.multilinePasteMode = snapshot.multilinePasteMode
  termSettings.middleClickPasteEnabled = snapshot.middleClickPasteEnabled ?? true
  termSettings.autoFullscreenOnConnect = snapshot.autoFullscreenOnConnect
  termSettings.graphicalOpenMode = snapshot.graphicalOpenMode ?? 'dedicated'
  termSettings.sidebarRailPosition = snapshot.sidebarRailPosition ?? 'right'
  termSettings.autocompleteEnabled = snapshot.autocompleteEnabled ?? true
  termSettings.aiAssistantEnabled = snapshot.aiAssistantEnabled ?? true

  localStorage.setItem(PRESET_KEY, snapshot.preset)
  localStorage.setItem(FONT_KEY, String(snapshot.fontSize))
  localStorage.setItem(FONT_FAMILY_KEY, snapshot.fontFamily)
  localStorage.setItem(THEME_KEY, snapshot.theme)
  localStorage.setItem(RIGHT_CLICK_KEY, snapshot.rightClickMode)
  localStorage.setItem(MULTILINE_PASTE_KEY, snapshot.multilinePasteMode)
  localStorage.setItem(MIDDLE_CLICK_PASTE_KEY, termSettings.middleClickPasteEnabled ? '1' : '0')
  localStorage.setItem(AUTO_FULLSCREEN_KEY, snapshot.autoFullscreenOnConnect ? '1' : '0')
  localStorage.setItem(GRAPHICAL_OPEN_MODE_KEY, termSettings.graphicalOpenMode)
  localStorage.setItem(SIDEBAR_RAIL_POSITION_KEY, termSettings.sidebarRailPosition)
  localStorage.setItem(AUTOCOMPLETE_ENABLED_KEY, termSettings.autocompleteEnabled ? '1' : '0')
  localStorage.setItem(AI_ASSISTANT_ENABLED_KEY, termSettings.aiAssistantEnabled ? '1' : '0')
  setShowTerminalToolbar(snapshot.showTerminalToolbar ?? true)
}

export function getTerminalPreferenceSnapshot(
  snippetShortcutMode: SnippetShortcutMode,
  hostSwitcherShortcutMode: HostSwitcherShortcutMode,
): TerminalPreferenceSnapshot {
  return {
    preset: termSettings.preset as PersistedTerminalPreset,
    fontSize: termSettings.fontSize,
    fontFamily: termSettings.fontFamily,
    theme: termSettings.theme,
    rightClickMode: termSettings.rightClickMode,
    multilinePasteMode: termSettings.multilinePasteMode,
    middleClickPasteEnabled: termSettings.middleClickPasteEnabled,
    autoFullscreenOnConnect: termSettings.autoFullscreenOnConnect,
    graphicalOpenMode: termSettings.graphicalOpenMode,
    snippetShortcutMode,
    hostSwitcherShortcutMode,
    showTerminalToolbar: termSettings.showTerminalToolbar,
    sidebarRailPosition: termSettings.sidebarRailPosition,
    autocompleteEnabled: termSettings.autocompleteEnabled,
    aiAssistantEnabled: termSettings.aiAssistantEnabled,
  }
}
