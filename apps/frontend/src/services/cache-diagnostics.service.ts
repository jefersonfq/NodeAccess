import {
  clearAllRegisteredCaches,
  listCacheRegistry,
  refreshAllRegisteredCaches,
} from './service-cache'

const CACHE_DIAGNOSTICS_KEY = '__NODEACCESS_CACHE_DIAGNOSTICS__'

function isLocalDiagnosticsAllowed() {
  if (typeof window === 'undefined') return false
  return import.meta.env.DEV
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
}

function cloneSnapshot() {
  return {
    at: Date.now(),
    caches: listCacheRegistry(),
  }
}

export function initCacheDiagnostics() {
  if (!isLocalDiagnosticsAllowed()) return

  Object.defineProperty(window, CACHE_DIAGNOSTICS_KEY, {
    configurable: true,
    value: {
      snapshot: cloneSnapshot,
      clearAll: () => clearAllRegisteredCaches(),
      refreshAll: () => refreshAllRegisteredCaches(),
    },
  })
}
