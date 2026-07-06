import { ref } from 'vue'
import type { HostsDefaultView, UserHostPreferences } from '@nodeaccess/shared'

export type HostDisplayMode = UserHostPreferences['displayMode']

const DISPLAY_MODE_KEY = 'na_hosts_display_mode'
const QUICK_ACCESS_COLLAPSED_KEY = 'na_hosts_quick_access_collapsed'
const PRODUCTIVITY_COLLAPSED_KEY = 'na_hosts_productivity_collapsed'
const FOLDERS_PANEL_EXPANDED_KEY = 'na_hosts_folders_panel_expanded'
const GROUPS_PANEL_EXPANDED_KEY = 'na_hosts_groups_panel_expanded'
const TAGS_PANEL_EXPANDED_KEY = 'na_hosts_tags_panel_expanded'
const DEFAULT_VIEW_KEY = 'na_hosts_default_view'
const HOME_MAX_FAVORITES_KEY = 'na_hosts_home_max_favorites'
const HOME_MAX_RECENTS_KEY = 'na_hosts_home_max_recents'

function readMode(): HostDisplayMode {
  if (typeof window === 'undefined') return 'cards'
  const value = window.localStorage.getItem(DISPLAY_MODE_KEY)
  return value === 'list' ? 'list' : 'cards'
}

function readBoolean(key: string, fallback = false): boolean {
  if (typeof window === 'undefined') return fallback
  const value = window.localStorage.getItem(key)
  if (value === null) return fallback
  return value === '1'
}

function readDefaultView(): HostsDefaultView {
  if (typeof window === 'undefined') return 'home'
  const value = window.localStorage.getItem(DEFAULT_VIEW_KEY)
  return value === 'list' ? 'list' : 'home'
}

function readInt(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw === null) return fallback
  const parsed = parseInt(raw, 10)
  if (isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export const hostDisplayMode = ref<HostDisplayMode>(readMode())
export const quickAccessCollapsed = ref(readBoolean(QUICK_ACCESS_COLLAPSED_KEY, true))
export const productivityCollapsed = ref(readBoolean(PRODUCTIVITY_COLLAPSED_KEY))
export const foldersPanelExpandedPreference = ref(readBoolean(FOLDERS_PANEL_EXPANDED_KEY))
export const groupsPanelExpandedPreference = ref(readBoolean(GROUPS_PANEL_EXPANDED_KEY))
export const tagsPanelExpandedPreference = ref(readBoolean(TAGS_PANEL_EXPANDED_KEY))
export const hostsDefaultView = ref<HostsDefaultView>(readDefaultView())
export const homeMaxFavorites = ref(readInt(HOME_MAX_FAVORITES_KEY, 6, 5, 30))
export const homeMaxRecents = ref(readInt(HOME_MAX_RECENTS_KEY, 6, 5, 30))

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

export function setFoldersPanelExpandedPreference(value: boolean) {
  foldersPanelExpandedPreference.value = value
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FOLDERS_PANEL_EXPANDED_KEY, value ? '1' : '0')
  }
}

export function setGroupsPanelExpandedPreference(value: boolean) {
  groupsPanelExpandedPreference.value = value
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(GROUPS_PANEL_EXPANDED_KEY, value ? '1' : '0')
  }
}

export function setTagsPanelExpandedPreference(value: boolean) {
  tagsPanelExpandedPreference.value = value
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TAGS_PANEL_EXPANDED_KEY, value ? '1' : '0')
  }
}

export function setHostsDefaultView(value: HostsDefaultView) {
  hostsDefaultView.value = value
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DEFAULT_VIEW_KEY, value)
  }
}

export function setHomeMaxFavorites(value: number) {
  const clamped = Math.min(30, Math.max(5, Math.floor(value)))
  homeMaxFavorites.value = clamped
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(HOME_MAX_FAVORITES_KEY, String(clamped))
  }
}

export function setHomeMaxRecents(value: number) {
  const clamped = Math.min(30, Math.max(5, Math.floor(value)))
  homeMaxRecents.value = clamped
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(HOME_MAX_RECENTS_KEY, String(clamped))
  }
}

export function applyHostPreferenceSnapshot(snapshot: UserHostPreferences) {
  setHostDisplayMode(snapshot.displayMode)
  setQuickAccessCollapsed(snapshot.quickAccessCollapsed)
  setProductivityCollapsed(snapshot.productivityCollapsed)
  setFoldersPanelExpandedPreference(snapshot.foldersPanelExpanded)
  setGroupsPanelExpandedPreference(snapshot.groupsPanelExpanded)
  setTagsPanelExpandedPreference(snapshot.tagsPanelExpanded)
  setHostsDefaultView(snapshot.hostsDefaultView)
  setHomeMaxFavorites(snapshot.homeMaxFavorites)
  setHomeMaxRecents(snapshot.homeMaxRecents)
}

export function getHostPreferenceSnapshot(): Pick<
  UserHostPreferences,
  | 'displayMode'
  | 'quickAccessCollapsed'
  | 'productivityCollapsed'
  | 'foldersPanelExpanded'
  | 'groupsPanelExpanded'
  | 'tagsPanelExpanded'
  | 'hostsDefaultView'
  | 'homeMaxFavorites'
  | 'homeMaxRecents'
> {
  return {
    displayMode: hostDisplayMode.value,
    quickAccessCollapsed: quickAccessCollapsed.value,
    productivityCollapsed: productivityCollapsed.value,
    foldersPanelExpanded: foldersPanelExpandedPreference.value,
    groupsPanelExpanded: groupsPanelExpandedPreference.value,
    tagsPanelExpanded: tagsPanelExpandedPreference.value,
    hostsDefaultView: hostsDefaultView.value,
    homeMaxFavorites: homeMaxFavorites.value,
    homeMaxRecents: homeMaxRecents.value,
  }
}
