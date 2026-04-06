import { ref } from 'vue'
import type { UserHostPreferences } from '@nodeaccess/shared'

const FAVORITES_KEY = 'na_hosts_favorites'
const RECENTS_KEY = 'na_hosts_recents'
const MAX_RECENTS = 8

function readIds(key: string): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  } catch {
    return []
  }
}

function writeIds(key: string, ids: number[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(ids))
}

export const favoriteHostIds = ref<number[]>(readIds(FAVORITES_KEY))
export const recentHostIds = ref<number[]>(readIds(RECENTS_KEY))

function normalizeIds(ids: number[]): number[] {
  return ids
    .map((value) => Number(value))
    .filter((value, index, array) => Number.isInteger(value) && value > 0 && array.indexOf(value) === index)
}

export function applyHostQuickAccessSnapshot(snapshot: Pick<UserHostPreferences, 'favoriteHostIds' | 'recentHostIds'>) {
  favoriteHostIds.value = normalizeIds(snapshot.favoriteHostIds)
  recentHostIds.value = normalizeIds(snapshot.recentHostIds).slice(0, MAX_RECENTS)
  writeIds(FAVORITES_KEY, favoriteHostIds.value)
  writeIds(RECENTS_KEY, recentHostIds.value)
}

export function getHostQuickAccessSnapshot(): Pick<UserHostPreferences, 'favoriteHostIds' | 'recentHostIds'> {
  return {
    favoriteHostIds: [...favoriteHostIds.value],
    recentHostIds: [...recentHostIds.value],
  }
}

export function isFavoriteHost(hostId: number) {
  return favoriteHostIds.value.includes(hostId)
}

export function toggleFavoriteHost(hostId: number) {
  favoriteHostIds.value = isFavoriteHost(hostId)
    ? favoriteHostIds.value.filter((id) => id !== hostId)
    : [hostId, ...favoriteHostIds.value]
  writeIds(FAVORITES_KEY, favoriteHostIds.value)
}

export function markHostAsRecent(hostId: number) {
  recentHostIds.value = [hostId, ...recentHostIds.value.filter((id) => id !== hostId)].slice(0, MAX_RECENTS)
  writeIds(RECENTS_KEY, recentHostIds.value)
}
