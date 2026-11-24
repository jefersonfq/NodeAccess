import type { VaultAuthMethod, VaultAuthority, VaultEvent, VaultIdentity, VaultOrigin, VaultSecret, VaultAction, VaultChange } from './vault-domain.js'
import type { ExtensionRecords } from './vault-extension-domain.js'
export type RecordKind = 'client' | 'challenge' | 'session' | 'operation' | 'provider' | 'webauthn' | 'extproof'
export interface VaultTransaction {
  authority: VaultAuthority
  now(): number
  get<T>(kind: RecordKind, token: string): Promise<T | null>
  put(kind: RecordKind, token: string, value: object, expiresAt: number): Promise<void>
  remove(kind: RecordKind, token: string): Promise<void>
  limit(key: string, windowMs: number, max: number): Promise<void>
  secret(id: number, action: VaultAction): Promise<VaultSecret>
  /** `windowSeconds`: NA-0188 tenant proposal validity (default 120 s). */
  propose(id: string, change: VaultChange, windowSeconds?: number): Promise<void>
  /** `byReference`: `id` is the stored proposal hash shown to managers, not the original identifier. */
  approve(id: string, byReference?: boolean): Promise<{ change: VaultChange; proposedBy: number }>
  audit(event: VaultEvent): Promise<void>
  /** NA-0183 extension records, in the same locked transaction as the authority read. */
  extension?: ExtensionRecords
  /** NA-0183 read side of the two-manager administration (portal screen). */
  administration?: AdministrationReads
  /** NA-0198: Windows Hello / passkey credentials of this identity. */
  webauthn?: WebauthnRecords
  /** NA-0196: own grants and released items visible to this identity. */
  availability?(): Promise<Omit<VaultAvailability, 'policy'>>
}
export interface VaultAdministrationUser { id: number; name: string; email: string; /** NA-0188 */ manager: boolean; grants: Record<'reveal' | 'copy' | 'extension', boolean> }
export interface VaultAdministrationProposal { reference: string; change: VaultChange; proposedBy: { id: number; name: string }; mine: boolean; expiresAt: number
  /** Grant beneficiary (same tenant), even when outside the bounded user list. */
  beneficiary: { id: number; name: string; email: string } | null
  /** NA-0196: item of an item proposal (same tenant), so the approver sees what is released. */
  item: { id: number; alias: string } | null }
export interface VaultAdministrationOverview { users: VaultAdministrationUser[]; proposals: VaultAdministrationProposal[]; serverNow: number
  /** NA-0196: Secrets released for delivery (not revoked). */
  items: Array<{ id: number; alias: string }> }
/** NA-0186: the overview also shows the tenant's current confirmation time (read from the locked policy). */
export interface VaultAdministrationView extends VaultAdministrationOverview { policy: { confirmationSeconds: number; /** NA-0188 */ proposalSeconds: number
  /** NA-0196 */ reveal: boolean; copy: boolean; tenantQuota: number } }
/** NA-0199: tenant vault settings shown in /admin/settings (values only; changes stay two-manager proposals). */
export interface VaultSettingsView { manager: boolean; reveal: boolean; copy: boolean; tenantQuota: number; confirmationSeconds: number; proposalSeconds: number; origin: string; webauthn: boolean }
/** NA-0196: what the signed-in user may expect before unlocking (guidance only; every delivery is still decided by the server). */
export interface VaultAvailability { policy: { reveal: boolean; copy: boolean }; grants: { reveal: boolean; copy: boolean }; items: number[] }
/** NA-0188 status: pending count and manager ids only for managers (zero/empty otherwise). */
export interface VaultAdministrationSummary { manager: boolean; pending: number; managers: number[] }
export interface AdministrationReads {
  isManager(): Promise<boolean>
  summary(): Promise<VaultAdministrationSummary>
  overview(): Promise<VaultAdministrationOverview>
}
export interface VaultStore { transaction<T>(identity: VaultIdentity, run: (tx: VaultTransaction) => Promise<T>): Promise<T> }
export interface OriginVerifier {
  bind(token: string, identity: VaultIdentity): Promise<VaultOrigin>
  assert(origin: VaultOrigin, identity: VaultIdentity): Promise<void>
  /** NA-0193: whether a login method may unlock at all now (external methods behind their flag); absent = local only. */
  allows?(method: VaultAuthMethod): boolean
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
/** NA-0198: a WebAuthn credential of the transaction identity (public key only; never a secret). */
export interface WebauthnCredential { id: string; publicKey: Uint8Array; counter: number; transports: string[]; name: string; createdAt: number; lastUsedAt: number | null }
/** Scoped to the transaction identity (tenant and user). */
export interface WebauthnRecords {
  list(): Promise<WebauthnCredential[]>
  find(id: string): Promise<WebauthnCredential | null>
  /** False when the credential id already exists (any user). */
  add(credential: Omit<WebauthnCredential, 'createdAt' | 'lastUsedAt'>): Promise<boolean>
  used(id: string, counter: number): Promise<void>
  remove(id: string): Promise<boolean>
}
/** Maintained WebAuthn implementation behind a port (NA-0198: @simplewebauthn/server). Challenges are base64url. */
export interface WebauthnVerifier {
  authenticationOptions(input: { rpID: string; challenge: string; allow: Array<{ id: string; transports: string[] }> }): Promise<object>
  /** Null on any failure (challenge, origin, RP ID, signature, user verification, counter). */
  verifyAuthentication(input: { response: unknown; challenge: string; origin: string; rpID: string; credential: WebauthnCredential }): Promise<{ counter: number } | null>
  registrationOptions(input: { rpID: string; rpName: string; userHandle: Uint8Array; userName: string; challenge: string; exclude: Array<{ id: string; transports: string[] }> }): Promise<object>
  verifyRegistration(input: { response: unknown; challenge: string; origin: string; rpID: string }): Promise<{ id: string; publicKey: Uint8Array; counter: number; transports: string[] } | null>
}
