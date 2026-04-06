import { ref } from 'vue'
import type { UserHostPreferences } from '@nodeaccess/shared'

export type HostDisplayMode = UserHostPreferences['displayMode']

const DISPLAY_MODE_KEY = 'na_hosts_display_mode'
const QUICK_ACCESS_COLLAPSED_KEY = 'na_hosts_quick_access_collapsed'
const PRODUCTIVITY_COLLAPSED_KEY = 'na_hosts_productivity_collapsed'

function readMode(): HostDisplayMode {
  if (typeof window === 'undefined') return 'cards'
  const value = window.localStorage.getItem(DISPLAY_MODE_KEY)
  return value === 'list' ? 'list' : 'cards'
}

function readBoolean(key: string): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(key) === '1'
}

export const hostDisplayMode = ref<HostDisplayMode>(readMode())
export const quickAccessCollapsed = ref(readBoolean(QUICK_ACCESS_COLLAPSED_KEY))
export const productivityCollapsed = ref(readBoolean(PRODUCTIVITY_COLLAPSED_KEY))

export function setHostDisplayMode(mode: HostDisplayMode) {
  hostDisplayMode.value = mode
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DISPLAY_MODE_KEY, mode)
  }
}

export function setQuickAccessCollapsed(value: boolean) {
  quickAccessCollapsed.value = value
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(QUICK_ACCESS_COLLAPSED_KEY, value ? '1' : '0')
  }
}

export function setProductivityCollapsed(value: boolean) {
  productivityCollapsed.value = value
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PRODUCTIVITY_COLLAPSED_KEY, value ? '1' : '0')
  }
}

export function applyHostPreferenceSnapshot(snapshot: UserHostPreferences) {
  setHostDisplayMode(snapshot.displayMode)
  setQuickAccessCollapsed(snapshot.quickAccessCollapsed)
  setProductivityCollapsed(snapshot.productivityCollapsed)
}

export function getHostPreferenceSnapshot(): Pick<
  UserHostPreferences,
  'displayMode' | 'quickAccessCollapsed' | 'productivityCollapsed'
> {
  return {
    displayMode: hostDisplayMode.value,
    quickAccessCollapsed: quickAccessCollapsed.value,
    productivityCollapsed: productivityCollapsed.value,
  }
}
