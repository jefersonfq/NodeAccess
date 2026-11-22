import type { VaultIdentity, VaultOrigin } from './vault-domain.js'

/** NA-0183 — browser extension (slice E1): one-time PKCE code and DPoP-bound opaque authorization. */
export type ExtensionTokenKind = 'code' | 'access'
export interface ExtensionCode {
  sessionVersion: number; extensionId: string; redirectUri: string; codeChallenge: string
  origin: VaultOrigin; policyVersion: number; expiresAt: number
}
export interface ExtensionAccess {
  sessionVersion: number; extensionId: string; origin: VaultOrigin; policyVersion: number; expiresAt: number
}
export interface ExtensionDeviceRow {
  jkt: string; extensionId: string; state: 'ACTIVE' | 'REVOKED'; createdAt: number; lastUsedAt: number | null
}
/** Locked reads/writes bound to the transaction identity; never crosses tenant or user. */
export interface ExtensionRecords {
  /** Grant `extension` enabled with two distinct managers, none of them the beneficiary. */
  entitled(): Promise<boolean>
  device(jkt: string): Promise<ExtensionDeviceRow | null>
  activateDevice(jkt: string, extensionId: string): Promise<void>
  touchDevice(jkt: string): Promise<void>
  revokeDevice(jkt: string): Promise<boolean>
  devices(): Promise<ExtensionDeviceRow[]>
  put(kind: ExtensionTokenKind, token: string, jkt: string, value: ExtensionCode | ExtensionAccess, expiresAt: number): Promise<void>
  /** Reads and deletes in one step: the token cannot be presented again whatever happens next. */
  take<T extends ExtensionCode | ExtensionAccess>(kind: ExtensionTokenKind, token: string): Promise<{ jkt: string; value: T } | null>
  get<T extends ExtensionCode | ExtensionAccess>(kind: ExtensionTokenKind, token: string): Promise<{ jkt: string; value: T } | null>
}
/** Global, unlocked lookup of who a public token claims to belong to; every claim is re-checked under lock. */
export interface ExtensionLocator {
  locate(kind: ExtensionTokenKind, token: string): Promise<VaultIdentity | null>
}
/** Single-use DPoP `jti` within its acceptance window. */
export interface ReplayGuard { claim(key: string, ttlMs: number): Promise<boolean> }
export interface ExtensionConfig {
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
