import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UiThemeMode } from '@nodeaccess/shared'

const UI_THEME_KEY = 'na_ui_theme_mode'
const UI_AUTO_COLLAPSE_SIDEBAR_ON_TERMINAL_KEY = 'na_ui_auto_collapse_sidebar_on_terminal'

function readThemeMode(): UiThemeMode {
  if (typeof window === 'undefined') return 'dark'
  return window.localStorage.getItem(UI_THEME_KEY) === 'light' ? 'light' : 'dark'
}

function readAutoCollapseSidebarOnTerminal() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(UI_AUTO_COLLAPSE_SIDEBAR_ON_TERMINAL_KEY) === '1'
}

export const useUiStore = defineStore('ui', () => {
  const themeMode = ref<UiThemeMode>(readThemeMode())
  const isDark   = ref(themeMode.value !== 'light')
  const loading  = ref(false)
  const autoCollapseSidebarOnTerminal = ref(readAutoCollapseSidebarOnTerminal())

  function setThemeMode(mode: UiThemeMode) {
    themeMode.value = mode
    isDark.value = mode !== 'light'
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UI_THEME_KEY, mode)
    }
  }

  function toggleTheme() {
    setThemeMode(isDark.value ? 'light' : 'dark')
  }

  function setAutoCollapseSidebarOnTerminal(value: boolean) {
    autoCollapseSidebarOnTerminal.value = value
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UI_AUTO_COLLAPSE_SIDEBAR_ON_TERMINAL_KEY, value ? '1' : '0')
    }
  }

  return {
    isDark,
    loading,
    themeMode,
    autoCollapseSidebarOnTerminal,
    setThemeMode,
    setAutoCollapseSidebarOnTerminal,
    toggleTheme,
  }
})
