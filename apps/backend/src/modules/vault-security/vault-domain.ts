/** Vault policy is independent of HTTP, storage and operational credential consumers. */
export type VaultAction = 'reveal' | 'copy'
/** Per-user grants: delivery actions plus NA-0183 browser-extension use. */
export type VaultGrant = VaultAction | 'extension' | 'shared-write' | 'fill'
export interface VaultIdentity { userId: number; tenantId: number; sessionVersion: number }
/** Central login methods that may unlock the vault; break-glass and unknown methods never do. */
export type VaultAuthMethod = 'local' | 'ldap' | 'oidc' | 'google'
export interface VaultOrigin { jti: string; expiresAt: number; authMethod: VaultAuthMethod }
export interface VaultPolicy { version: number; unlock: boolean; reveal: boolean; copy: boolean; localReauth: boolean; origin: string; tenantQuota: number
  /** NA-0186: how long an unlock proof stays valid for reveal/copy (whole minutes, 60–900 s; absent = 60 s, contract default). */
  confirmationSeconds?: number
  /** NA-0188: how long a two-manager proposal stays open (whole minutes, 120 s–24 h; absent = 120 s). */
  proposalSeconds?: number }
export interface VaultAuthority {
  policy: VaultPolicy; validUntil: number; role: 'ADMIN' | 'USER'; passwordHash: string | null; mfaSecret: string; credentialVersion: string
  email: string; methods: Record<VaultAuthMethod, boolean>
}
export interface VaultClient { id: string; sessionVersion: number; origin: VaultOrigin; policyVersion: number; expiresAt: number }
export interface VaultChallenge { clientId: string; credentialVersion: string; expiresAt: number; /** NA-0198: WebAuthn challenge (base64url) when offered. */ webauthn?: string }
/** NA-0198: WebAuthn RP ID of the vault origin; null for IP literals, which browsers refuse as RP IDs. */
export function webauthnRpId(origin: string): string | null {
  let host: string
  try { host = new URL(origin).hostname } catch { return null }
  if (!host || host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null
  return host
}
export interface VaultSession { clientId: string; policyVersion: number; credentialVersion: string; proofAt: number; idleUntil: number; expiresAt: number }
export interface VaultOperation {
  clientId: string; sessionId: string; action: VaultAction; secretId: number; secretVersion: string;
  recipient: { kty: 'RSA'; n: string; e: string }; recipientThumbprint: string;
  policyVersion: number; expiresAt: number; state: 'AUTHORIZED' | 'CONSUMED' | 'CANCELLED'
}
export interface VaultSecret { version: string; encrypted: string; iv: string }
export interface VaultEvent { type: string; clientId?: string; operationId?: string; /** Already-hashed operation reference (approval by proposal reference). */ operationRef?: string; action?: VaultAction; secretId?: number; policyVersion: number; change?: VaultChange; proposedBy?: number; reasonCode?: string; device?: string }
export class VaultError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code) }
}
export function denied(): never { throw new VaultError('VAULT_FORBIDDEN', 403) }
export function unavailable(): never { throw new VaultError('OPERATION_UNAVAILABLE', 409) }
/** NA-0191: the identity confirmation itself failed (password, authenticator code or provider proof); same 403, own code
 * so the portal does not present it as a missing permission. Never says which factor failed. */
export function reauthFailed(): never { throw new VaultError('VAULT_REAUTH_FAILED', 403) }
export const CONFIRMATION_DEFAULT_SECONDS = 60
export const CONFIRMATION_MAX_SECONDS = 900
export function validConfirmationSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= CONFIRMATION_DEFAULT_SECONDS && value <= CONFIRMATION_MAX_SECONDS && value % 60 === 0
}
export const PROPOSAL_DEFAULT_SECONDS = 120
export const PROPOSAL_MAX_SECONDS = 86_400
export function validProposalSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= PROPOSAL_DEFAULT_SECONDS && value <= PROPOSAL_MAX_SECONDS && value % 60 === 0
}
export function proposalWindowMs(policy: VaultPolicy): number {
  return (policy.proposalSeconds ?? PROPOSAL_DEFAULT_SECONDS) * 1000
}
/** NA-0188: no manager other than the proposer and the beneficiary could approve it. Removing a manager therefore
 * always leaves at least two (proposer + approver), so the vault never becomes unmanageable. */
export function noApprover(): never { throw new VaultError('VAULT_NO_APPROVER', 409) }
/** Proof window for reveal/copy; administration and extension consent always keep the 60 s default. */
export function operationProofWindowMs(policy: VaultPolicy): number {
  return (policy.confirmationSeconds ?? CONFIRMATION_DEFAULT_SECONDS) * 1000
}
export function assertPolicy(policy: VaultPolicy): void {
  if (policy.unlock !== true || policy.localReauth !== true || typeof policy.reveal !== 'boolean' || typeof policy.copy !== 'boolean' || !Number.isSafeInteger(policy.version) || policy.version < 1
    || !Number.isSafeInteger(policy.tenantQuota) || policy.tenantQuota < 1 || policy.tenantQuota > 300
    || (policy.confirmationSeconds !== undefined && !validConfirmationSeconds(policy.confirmationSeconds))
    || (policy.proposalSeconds !== undefined && !validProposalSeconds(policy.proposalSeconds))) denied()
  try { const u = new URL(policy.origin); if (u.protocol !== 'https:' || u.origin !== policy.origin) denied() } catch { denied() }
}
export function assertSession(session: VaultSession | null, client: VaultClient, authority: VaultAuthority, now: number): asserts session is VaultSession {
  if (!session || session.clientId !== client.id || session.policyVersion !== authority.policy.version
    || session.credentialVersion !== authority.credentialVersion || now >= session.idleUntil || now >= session.expiresAt) {
    throw new VaultError('VAULT_LOCKED', 423)
  }
}
export function grantDeadline(session: VaultSession, client: VaultClient, now: number, authorityDeadline: number,
  proofWindowMs = CONFIRMATION_DEFAULT_SECONDS * 1000): number {
  const deadline = Math.min(authorityDeadline, now + 30_000, session.idleUntil, session.expiresAt, client.expiresAt, client.origin.expiresAt, session.proofAt + proofWindowMs)
  if (deadline <= now) throw new VaultError('VAULT_STEP_UP_REQUIRED', 423)
  return deadline
}

export type VaultChange = { kind: 'grant'; userId: number; action: VaultGrant; enabled: boolean }
  | { kind: 'item'; secretId: number; enabled: boolean }
  | { kind: 'policy'; reveal: boolean; copy: boolean; tenantQuota: number }
  | { kind: 'confirmation'; seconds: number }
  /** NA-0188: vault manager added/removed by two other managers. */
  | { kind: 'manager'; userId: number; enabled: boolean }
  | { kind: 'proposalWindow'; seconds: number }

/** Same authenticated context at authorization and release; deadline is immutable. */
export interface VaultEnvelopeContext {
  version: 1; operationId: string; tenantId: number; userId: number; clientId: string;
  action: VaultAction; itemRef: `secret:${number}`; recipientThumbprint: string;
  policyVersion: number; secretVersion: string; expiresAt: number; origin: string
}
export function vaultEnvelopeContext(identity: VaultIdentity, operationId: string, op: VaultOperation, origin: string): VaultEnvelopeContext {
  return { version: 1, operationId, tenantId: identity.tenantId, userId: identity.userId,
    clientId: op.clientId, action: op.action, itemRef: `secret:${op.secretId}`,
    recipientThumbprint: op.recipientThumbprint, policyVersion: op.policyVersion,
    secretVersion: op.secretVersion, expiresAt: op.expiresAt, origin }
}
