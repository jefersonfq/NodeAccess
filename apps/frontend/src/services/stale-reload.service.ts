const STALE_CHUNK_RELOAD_KEY = 'na:stale-chunk-reload'

export function markStaleReloadTarget(path: string) {
  window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, path)
}

export function clearStaleReloadTarget() {
  window.sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY)
}

export function getStaleReloadTarget(): string | null {
  return window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)
}

export function consumeRecoveredStaleReload(path: string): boolean {
  const target = getStaleReloadTarget()
  if (target !== path) return false
  clearStaleReloadTarget()
  return true
}
