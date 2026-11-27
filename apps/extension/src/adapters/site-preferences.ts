import { createSitePreferences, type SitePreferencesPort } from '../core/site-preferences'
import { chromiumSession } from './chromium'
import type { ExtensionClient } from '../core/client'

/** Persistent preferences contain resource references only; content scripts cannot access this area. */
export function chromiumSitePreferences(client: ExtensionClient, scope: string, kind: 'sites' | 'hosts'): SitePreferencesPort {
  return createSitePreferences({ origin: __PORTAL_ORIGIN__, scope, kind,
    current: async (): Promise<boolean> => {
      const auth = await chromiumSession.get()
      if (!auth || auth.expiresAt <= Date.now()) return false
      const caps = await client.capabilities()
      const latest = await chromiumSession.get()
      return latest?.accessToken === auth.accessToken && latest.expiresAt > Date.now() && caps.preferenceScope === scope
    },
    storage: {
      async get(key): Promise<unknown> {
        await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
        return (await chrome.storage.local.get(key))[key]
      },
      async set(key, value): Promise<void> {
        await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
        await chrome.storage.local.set({ [key]: value })
      },
      lock: async (key, run) => await navigator.locks.request(key, run),
    },
  })
}
