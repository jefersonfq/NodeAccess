/**
 * NA-0183 — VaultNAccess extension core (slice E1). No browser-extension API is used in `core/`:
 * the Chromium adapter implements these ports, so the core runs unchanged in tests and other browsers.
 */
export interface DeviceKey {
  /** Non-extractable ECDSA P-256 private key; only signs DPoP proofs. */
  privateKey: CryptoKey
  publicJwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string }
  /** RFC 7638 SHA-256 thumbprint (base64url). */
  jkt: string
}
/** Persistent device key (IndexedDB in Chromium). Never exported, never synced. */
export interface DeviceKeyStore {
  load(): Promise<DeviceKey | null>
  save(key: DeviceKey): Promise<void>
}
/** Authorization kept only in session memory (chrome.storage.session); gone when the browser closes. */
export interface Authorization { accessToken: string; portalOrigin: string; expiresAt: number }
export interface SessionStore {
  get(): Promise<Authorization | null>
  set(value: Authorization): Promise<void>
  clear(): Promise<void>
  recents(): Promise<string[]>
  setRecents(keys: string[]): Promise<void>
  /** NA-0192: language the portal was using at the last connection (`pt-BR` | `en`). */
  locale(): Promise<string | null>
  setLocale(locale: string): Promise<void>
}
/** Interactive consent window; resolves with the final redirect URL. */
export interface AuthFlow {
  redirectUri(): string
  launch(url: string): Promise<string>
}
export interface ExtensionInfo { id: string; version: string; portalOrigin: string }
