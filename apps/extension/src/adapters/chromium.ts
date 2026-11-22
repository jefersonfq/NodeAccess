import type { AuthFlow, Authorization, DeviceKey, DeviceKeyStore, ExtensionInfo, SessionStore } from '../core/ports'

/** Chromium (Chrome/Edge) adapter: identity, storage.session, IndexedDB and tabs. Nothing in storage.local/sync. */
export function extensionInfo(): ExtensionInfo {
  return { id: chrome.runtime.id, version: chrome.runtime.getManifest().version, portalOrigin: __PORTAL_ORIGIN__ }
}
export const chromiumAuthFlow: AuthFlow = {
  redirectUri: () => chrome.identity.getRedirectURL(),
  async launch(url: string): Promise<string> {
    const result = await chrome.identity.launchWebAuthFlow({ url, interactive: true })
    if (!result) throw new Error('cancelled')
    return result
  },
}
const AUTH = 'authorization', RECENTS = 'recents'
export const chromiumSession: SessionStore = {
  async get(): Promise<Authorization | null> {
    const value = (await chrome.storage.session.get(AUTH))[AUTH] as Partial<Authorization> | undefined
    return value && typeof value.accessToken === 'string' && typeof value.portalOrigin === 'string' && typeof value.expiresAt === 'number'
      ? { accessToken: value.accessToken, portalOrigin: value.portalOrigin, expiresAt: value.expiresAt } : null
  },
  set: (value: Authorization): Promise<void> => chrome.storage.session.set({ [AUTH]: value }),
  clear: (): Promise<void> => chrome.storage.session.remove([AUTH, RECENTS]),
  async recents(): Promise<string[]> {
    const value = (await chrome.storage.session.get(RECENTS))[RECENTS]
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : []
  },
  setRecents: (keys: string[]): Promise<void> => chrome.storage.session.set({ [RECENTS]: keys }),
}
/** Session storage stays out of reach of any (future) content script. */
export async function restrictSession(): Promise<void> {
  await chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
}
const DB = 'vaultnaccess', STORE = 'device', KEY = 'current'
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = (): void => { request.result.createObjectStore(STORE) }
    request.onsuccess = (): void => resolve(request.result)
    request.onerror = (): void => reject(request.error ?? new Error('indexeddb'))
  })
}
/** CryptoKey objects are stored by structured clone; a non-extractable key stays non-extractable. */
export const indexedDbKeys: DeviceKeyStore = {
  async load(): Promise<DeviceKey | null> {
    const db = await database()
    try {
      return await new Promise<DeviceKey | null>((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
        request.onsuccess = (): void => resolve((request.result as DeviceKey | undefined) ?? null)
        request.onerror = (): void => reject(request.error ?? new Error('indexeddb'))
      })
    } finally { db.close() }
  },
  async save(key: DeviceKey): Promise<void> {
    const db = await database()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(key, KEY)
        tx.oncomplete = (): void => resolve()
        tx.onerror = (): void => reject(tx.error ?? new Error('indexeddb'))
      })
    } finally { db.close() }
  },
}
export function openTab(url: string): Promise<unknown> { return chrome.tabs.create({ url }) }
