import type { VaultAuthMethod, VaultIdentity, VaultOrigin } from './vault-domain.js'

/** NA-0183 — browser extension (slice E1): one-time PKCE code and DPoP-bound opaque authorization. */
/** `trust` (NA-0193): one row per trusted device (`trust:<jkt>`), alive 7 days from the last full consent. */
export type ExtensionTokenKind = 'code' | 'access' | 'trust'
export interface ExtensionCode {
  sessionVersion: number; extensionId: string; redirectUri: string; codeChallenge: string
  origin: VaultOrigin; policyVersion: number; expiresAt: number
}
/** `origin` is the consenting central session; `null` (NA-0193) when renewed with the authenticator code only. */
export interface ExtensionAccess {
  sessionVersion: number; extensionId: string; origin: VaultOrigin | null; policyVersion: number; expiresAt: number
  /** Code mode (origin null): login method of the consent, still checked against the tenant policy on every use. */
  method?: VaultAuthMethod
  /** NA-0195: last authenticator-code proof in the extension (reveal/copy within the tenant window). */
  proofAt?: number
}
/** NA-0193 trusted device: renewal without the portal consent page while alive. */
export interface ExtensionTrust {
  sessionVersion: number; extensionId: string; origin: VaultOrigin; failures: number; expiresAt: number
}
export type ExtensionTokenValue = ExtensionCode | ExtensionAccess | ExtensionTrust
export interface ExtensionDeviceRow {
  jkt: string; extensionId: string; state: 'ACTIVE' | 'REVOKED'; createdAt: number; lastUsedAt: number | null
}
/** Locked reads/writes bound to the transaction identity; never crosses tenant or user. */
export interface ExtensionRecords {
  /** Grant `extension` enabled with two distinct managers, none of them the beneficiary. */
  entitled(): Promise<boolean>
  /** NA-0195: the user's own reveal/copy grant, with the same two-manager rule. */
  granted(action: 'reveal' | 'copy' | 'shared-write' | 'fill'): Promise<boolean>
  device(jkt: string): Promise<ExtensionDeviceRow | null>
  activateDevice(jkt: string, extensionId: string): Promise<void>
  touchDevice(jkt: string): Promise<void>
  revokeDevice(jkt: string): Promise<boolean>
  devices(): Promise<ExtensionDeviceRow[]>
  put(kind: ExtensionTokenKind, token: string, jkt: string, value: ExtensionTokenValue, expiresAt: number): Promise<void>
  /** Reads and deletes in one step: the token cannot be presented again whatever happens next. */
  take<T extends ExtensionTokenValue>(kind: ExtensionTokenKind, token: string): Promise<{ jkt: string; value: T } | null>
  /** NA-0193: one trust per device key — removes the trust of this key for any user (a new full consent wins). */
  releaseTrust(jkt: string): Promise<void>
  /** NA-0193: every authorization of this key for this user. */
  dropAccess(jkt: string): Promise<void>
  get<T extends ExtensionTokenValue>(kind: ExtensionTokenKind, token: string): Promise<{ jkt: string; value: T } | null>
}
/** Global, unlocked lookup of who a public token claims to belong to; every claim is re-checked under lock. */
export interface ExtensionLocator {
  locate(kind: ExtensionTokenKind, token: string): Promise<VaultIdentity | null>
}
/** Single-use DPoP `jti` within its acceptance window. */
export interface ReplayGuard { claim(key: string, ttlMs: number): Promise<boolean> }
export interface ExtensionConfig {
  /** Independent E7 pilot switch, off unless explicitly enabled by the operator. */
  siteFillEnabled?: boolean
  /** Successful persistent generation rotation at API startup. Missing fails closed. */
  siteFillReady?: () => boolean
  enabled: boolean
  /** Allowed extension IDs; redirect URI is always https://<id>.chromiumapp.org/ */
  extensionIds: readonly string[]
  minVersion: string
}
export function extensionRedirectUri(extensionId: string): string {
  return `https://${extensionId}.chromiumapp.org/`
}
/** Numeric x.y.z comparison; malformed versions are treated as too old. */
export function versionAtLeast(version: string | undefined, minimum: string): boolean {
  const parse = (v: string | undefined): number[] | null => (v && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v) ? v.split('.').map(Number) : null)
  const a = parse(version), b = parse(minimum)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}
