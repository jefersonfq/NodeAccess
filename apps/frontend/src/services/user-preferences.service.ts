import { watch } from 'vue'
import type { PatchUserPreferencesDto, UserPreferences } from '@nodeaccess/shared'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { userService } from './user.service'
import { applyHostPreferenceSnapshot, getHostPreferenceSnapshot } from './host-view-preferences.service'
import { applyHostQuickAccessSnapshot, getHostQuickAccessSnapshot } from './host-quick-access.service'
import {
  applyTerminalPreferenceSnapshot,
  getTerminalPreferenceSnapshot,
  termSettings,
} from '@/composables/useTerminal'
import {
  hostSwitcherShortcutMode,
  setHostSwitcherShortcutMode,
  setSnippetShortcutMode,
  snippetShortcutMode,
} from '@/composables/usePlatform'

let initialized = false
let hydrating = false
let ready = false
let saveTimer: number | null = null
let lastSavedSnapshot = ''

function buildSnapshot(): UserPreferences {
  const ui = useUiStore()
  return {
    ui: {
      themeMode: ui.themeMode,
    },
    terminal: getTerminalPreferenceSnapshot(
      snippetShortcutMode.value,
      hostSwitcherShortcutMode.value,
    ),
    hosts: {
      ...getHostPreferenceSnapshot(),
      ...getHostQuickAccessSnapshot(),
    },
  }
}

function snapshotKey(snapshot: UserPreferences): string {
  return JSON.stringify(snapshot)
}

function applySnapshot(snapshot: UserPreferences) {
  const ui = useUiStore()
  hydrating = true
  try {
    ui.setThemeMode(snapshot.ui.themeMode)
    applyTerminalPreferenceSnapshot(snapshot.terminal)
    setSnippetShortcutMode(snapshot.terminal.snippetShortcutMode)
    setHostSwitcherShortcutMode(snapshot.terminal.hostSwitcherShortcutMode)
    applyHostPreferenceSnapshot(snapshot.hosts)
    applyHostQuickAccessSnapshot(snapshot.hosts)
  } finally {
    hydrating = false
  }
}

async function persistSnapshot(patch?: PatchUserPreferencesDto) {
  const auth = useAuthStore()
  if (!auth.isAuthenticated || !auth.user) return

  const current = buildSnapshot()
  const currentKey = snapshotKey(current)
  if (!patch && currentKey === lastSavedSnapshot) return

  const { data } = await userService.updatePreferences(patch ?? current)
  lastSavedSnapshot = snapshotKey(data)
}

function scheduleSave() {
  if (!ready || hydrating) return
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void persistSnapshot().catch(() => { /* best-effort */ })
  }, 350)
}

export function initUserPreferencesSync() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const auth = useAuthStore()
  useUiStore()

  watch(
    () => auth.user?.id ?? null,
    async (userId) => {
      ready = false
      if (!userId || !auth.isAuthenticated) return

      try {
        const { data } = await userService.getPreferences()
        if (data) {
          applySnapshot(data)
          lastSavedSnapshot = snapshotKey(data)
        } else {
          const localSnapshot = buildSnapshot()
          lastSavedSnapshot = ''
          await persistSnapshot(localSnapshot)
        }
      } catch {
        lastSavedSnapshot = snapshotKey(buildSnapshot())
      } finally {
        ready = true
      }
    },
    { immediate: true },
  )

  watch(
    () => snapshotKey(buildSnapshot()),
    () => {
      scheduleSave()
    },
  )
}
