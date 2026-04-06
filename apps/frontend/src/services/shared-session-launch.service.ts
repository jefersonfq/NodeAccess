import type { SharedSessionResolved } from '@nodeaccess/shared'

const KEY = 'na_pending_shared_session'

export function savePendingSharedSession(data: SharedSessionResolved) {
  sessionStorage.setItem(KEY, JSON.stringify(data))
}

export function consumePendingSharedSession(): SharedSessionResolved | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  sessionStorage.removeItem(KEY)
  try {
    const parsed = JSON.parse(raw) as Omit<SharedSessionResolved, 'expiresAt'> & { expiresAt: string }
    return {
      ...parsed,
      expiresAt: new Date(parsed.expiresAt),
    }
  } catch {
    return null
  }
}
