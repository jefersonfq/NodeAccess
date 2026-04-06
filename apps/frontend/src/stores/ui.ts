import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UiThemeMode } from '@nodeaccess/shared'

const UI_THEME_KEY = 'na_ui_theme_mode'

function readThemeMode(): UiThemeMode {
  if (typeof window === 'undefined') return 'dark'
  return window.localStorage.getItem(UI_THEME_KEY) === 'light' ? 'light' : 'dark'
}

export const useUiStore = defineStore('ui', () => {
  const themeMode = ref<UiThemeMode>(readThemeMode())
  const isDark   = ref(themeMode.value !== 'light')
  const loading  = ref(false)

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

  return { isDark, loading, themeMode, setThemeMode, toggleTheme }
})
