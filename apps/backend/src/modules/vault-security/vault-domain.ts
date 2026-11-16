/** Vault policy is independent of HTTP, storage and operational credential consumers. */
export type VaultAction = 'reveal' | 'copy'
export interface VaultIdentity { userId: number; tenantId: number; sessionVersion: number }
export interface VaultOrigin { jti: string; expiresAt: number }
export interface VaultPolicy { version: number; unlock: boolean; reveal: boolean; copy: boolean; localReauth: boolean; origin: string; tenantQuota: number }
export interface VaultAuthority {
  policy: VaultPolicy; validUntil: number; role: 'ADMIN' | 'USER'; passwordHash: string; mfaSecret: string; credentialVersion: string
}
export interface VaultClient { id: string; sessionVersion: number; origin: VaultOrigin; policyVersion: number; expiresAt: number }
export interface VaultChallenge { clientId: string; credentialVersion: string; expiresAt: number }
export interface VaultSession { clientId: string; policyVersion: number; credentialVersion: string; proofAt: number; idleUntil: number; expiresAt: number }
export interface VaultOperation {
  clientId: string; sessionId: string; action: VaultAction; secretId: number; secretVersion: string;
  recipient: { kty: 'RSA'; n: string; e: string }; recipientThumbprint: string;
  policyVersion: number; expiresAt: number; state: 'AUTHORIZED' | 'CONSUMED' | 'CANCELLED'
}
export interface VaultSecret { version: string; encrypted: string; iv: string }
export interface VaultEvent { type: string; clientId?: string; operationId?: string; action?: VaultAction; secretId?: number; policyVersion: number; change?: VaultChange; proposedBy?: number; reasonCode?: string }
export class VaultError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code) }
}
export function denied(): never { throw new VaultError('VAULT_FORBIDDEN', 403) }
export function unavailable(): never { throw new VaultError('OPERATION_UNAVAILABLE', 409) }
export function assertPolicy(policy: VaultPolicy): void {
  if (policy.unlock !== true || policy.localReauth !== true || typeof policy.reveal !== 'boolean' || typeof policy.copy !== 'boolean' || !Number.isSafeInteger(policy.version) || policy.version < 1
    || !Number.isSafeInteger(policy.tenantQuota) || policy.tenantQuota < 1 || policy.tenantQuota > 300) denied()
  try { const u = new URL(policy.origin); if (u.protocol !== 'https:' || u.origin !== policy.origin) denied() } catch { denied() }
}
export function assertSession(session: VaultSession | null, client: VaultClient, authority: VaultAuthority, now: number): asserts session is VaultSession {
  if (!session || session.clientId !== client.id || session.policyVersion !== authority.policy.version
    || session.credentialVersion !== authority.credentialVersion || now >= session.idleUntil || now >= session.expiresAt) {
    throw new VaultError('VAULT_LOCKED', 423)
  }
}
export function grantDeadline(session: VaultSession, client: VaultClient, now: number, authorityDeadline: number): number {
  const deadline = Math.min(authorityDeadline, now + 30_000, session.idleUntil, session.expiresAt, client.expiresAt, client.origin.expiresAt, session.proofAt + 60_000)
  if (deadline <= now) throw new VaultError('VAULT_STEP_UP_REQUIRED', 423)
  return deadline
}

export type VaultChange = { kind: 'grant'; userId: number; action: VaultAction; enabled: boolean }
  | { kind: 'item'; secretId: number; enabled: boolean }
  | { kind: 'policy'; reveal: boolean; copy: boolean; tenantQuota: number }
