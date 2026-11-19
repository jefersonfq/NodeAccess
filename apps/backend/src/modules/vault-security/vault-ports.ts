import type { VaultAuthMethod, VaultAuthority, VaultEvent, VaultIdentity, VaultOrigin, VaultSecret, VaultAction, VaultChange } from './vault-domain.js'
export type RecordKind = 'client' | 'challenge' | 'session' | 'operation' | 'provider'
export interface VaultTransaction {
  authority: VaultAuthority
  now(): number
  get<T>(kind: RecordKind, token: string): Promise<T | null>
  put(kind: RecordKind, token: string, value: object, expiresAt: number): Promise<void>
  remove(kind: RecordKind, token: string): Promise<void>
  limit(key: string, windowMs: number, max: number): Promise<void>
  secret(id: number, action: VaultAction): Promise<VaultSecret>
  propose(id: string, change: VaultChange): Promise<void>
  approve(id: string): Promise<{ change: VaultChange; proposedBy: number }>
  audit(event: VaultEvent): Promise<void>
}
export interface VaultStore { transaction<T>(identity: VaultIdentity, run: (tx: VaultTransaction) => Promise<T>): Promise<T> }
export interface OriginVerifier {
  bind(token: string, identity: VaultIdentity): Promise<VaultOrigin>
  assert(origin: VaultOrigin, identity: VaultIdentity): Promise<void>
}
/** Step-up chosen by the signed method of the origin session, never by the client. */
export interface Reauthentication {
  verify(password: string, otp: string, authority: VaultAuthority, method: VaultAuthMethod, identity: VaultIdentity): Promise<boolean>
  /** NodeAccess TOTP after a provider proof that did not assert MFA. */
  verifySecondFactor(otp: string, authority: VaultAuthority): boolean
}
export type ProviderMethod = Extract<VaultAuthMethod, 'oidc' | 'google'>
export type ProviderStart = { kind: 'redirect'; authorizationUrl: string } | { kind: 'google'; clientId: string; nonce: string }
export interface ProviderProofInput { state?: string | undefined; code?: string | undefined; idToken?: string | undefined }
/** Fresh provider login for OIDC/Google sessions, bound to one vault challenge. */
export interface ProviderStepUp {
  begin(identity: VaultIdentity, method: ProviderMethod, binding: string): Promise<ProviderStart>
  complete(identity: VaultIdentity, method: ProviderMethod, binding: string, input: ProviderProofInput): Promise<{ mfa: boolean }>
}
export interface EnvelopeSealer {
  validate(key: { kty: 'RSA'; n: string; e: string }): Promise<string>
  seal(key: { kty: 'RSA'; n: string; e: string }, context: object, secret: VaultSecret): Promise<string>
}
export interface VaultEntropy { token(): string; digest(value: string): string }
