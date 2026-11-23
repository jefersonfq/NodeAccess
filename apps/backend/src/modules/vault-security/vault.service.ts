import { assertPolicy, assertSession, denied, grantDeadline, operationProofWindowMs, reauthFailed, unavailable, vaultEnvelopeContext, VaultError } from './vault-domain.js'
import type { VaultAuthMethod, VaultEnvelopeContext, VaultAction, VaultChallenge, VaultClient, VaultIdentity, VaultOperation, VaultSession } from './vault-domain.js'
import type { EnvelopeSealer, OriginVerifier, ProviderMethod, ProviderProofInput, ProviderStart, ProviderStepUp, Reauthentication, VaultEntropy, VaultStore, VaultTransaction } from './vault-ports.js'

/** Kind of confirmation the portal must render; derived from the signed origin method. */
function stepUpOf(method: VaultAuthMethod): 'password_totp' | 'provider' {
  return method === 'oidc' || method === 'google' ? 'provider' : 'password_totp'
}

export class VaultService {
  private active = 0
  constructor(private readonly store: VaultStore, private readonly origin: OriginVerifier,
    private readonly reauth: Reauthentication, private readonly envelope: EnvelopeSealer,
    private readonly entropy: VaultEntropy, private readonly now = Date.now, private readonly provider?: ProviderStepUp) {}

  /** Bounded admission: no unbounded queue in the shared application process. */
  async admitted<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= 4) throw new VaultError('VAULT_BUSY', 503)
    this.active++
    try { return await run() } finally { this.active-- }
  }
  private async client(tx: VaultTransaction, id: string, identity: VaultIdentity, origin: string): Promise<VaultClient> {
    assertPolicy(tx.authority.policy)
    if (origin !== tx.authority.policy.origin) denied()
    const client = await tx.get<VaultClient>('client', id)
    if (!client || client.id !== this.entropy.digest(id) || client.sessionVersion !== identity.sessionVersion || client.expiresAt <= tx.now() || client.policyVersion !== tx.authority.policy.version) throw new VaultError('VAULT_LOCKED', 423)
    // Tenant login policy can disable a method after the client was registered.
    if (tx.authority.methods[client.origin.authMethod] !== true) denied()
    await this.origin.assert(client.origin, identity)
    return client
  }
  async register(identity: VaultIdentity, refreshToken: string, requestOrigin: string): Promise<{ clientId: string; expiresAt: number; serverNow: number; stepUp: 'password_totp' | 'provider' }> {
    const origin = await this.origin.bind(refreshToken, identity)
    return this.store.transaction(identity, async tx => {
      assertPolicy(tx.authority.policy)
      if (requestOrigin !== tx.authority.policy.origin || tx.authority.methods[origin.authMethod] !== true) denied()
      await tx.limit('clients', 3_600_000, 10)
      const id = this.entropy.token(), expiresAt = Math.min(tx.now() + 1_800_000, origin.expiresAt, tx.authority.validUntil)
      await tx.put('client', id, { id: this.entropy.digest(id), sessionVersion: identity.sessionVersion, origin, policyVersion: tx.authority.policy.version, expiresAt }, expiresAt)
      await tx.audit({ type: 'CLIENT_REGISTERED', clientId: id, policyVersion: tx.authority.policy.version })
      return { clientId: id, expiresAt, serverNow: tx.now(), stepUp: stepUpOf(origin.authMethod) }
    })
  }
  async challenge(identity: VaultIdentity, clientId: string, origin: string): Promise<{ challengeId: string; expiresAt: number; serverNow: number; stepUp: 'password_totp' | 'provider' }> {
    return this.store.transaction(identity, async tx => {
      const client = await this.client(tx, clientId, identity, origin)
      await tx.limit('unlock', 300_000, 5)
      const challengeId = this.entropy.token(), expiresAt = Math.min(tx.now() + 120_000, client.expiresAt)
      await tx.put('challenge', challengeId, { clientId: client.id, credentialVersion: tx.authority.credentialVersion, expiresAt }, expiresAt)
      return { challengeId, expiresAt, serverNow: tx.now(), stepUp: stepUpOf(client.origin.authMethod) }
    })
  }
  async unlock(identity: VaultIdentity, clientId: string, origin: string, challengeId: string, password: string, otp: string): Promise<{ sessionId: string; idleUntil: number; expiresAt: number; serverNow: number; proofUntil: number }> {
    // Burn each challenge before expensive verification; failures cannot replay it.
    const proof = await this.store.transaction(identity, async tx => {
      const client = await this.client(tx, clientId, identity, origin)
      const c = await tx.get<VaultChallenge>('challenge', challengeId)
      if (!c || c.clientId !== this.entropy.digest(clientId) || c.expiresAt <= tx.now() || c.credentialVersion !== tx.authority.credentialVersion) denied()
      await tx.remove('challenge', challengeId)
      return { authority: tx.authority, expiresAt: c.expiresAt, method: client.origin.authMethod }
    })
    if (!await this.reauth.verify(password, otp, proof.authority, proof.method, identity)) {
      await this.store.transaction(identity, tx => tx.audit({ type: 'UNLOCK_DENIED', clientId, policyVersion: tx.authority.policy.version }))
      reauthFailed()
    }
    return this.openSession(identity, clientId, origin, proof)
  }
  /** Challenge still pending for this client and a provider method (OIDC/Google); nothing is burned here. */
  private async providerContext(tx: VaultTransaction, identity: VaultIdentity, clientId: string, origin: string, challengeId: string): Promise<{ method: ProviderMethod; client: VaultClient; challenge: VaultChallenge }> {
    const client = await this.client(tx, clientId, identity, origin)
    const method = client.origin.authMethod
    if (method !== 'oidc' && method !== 'google') denied()
    const challenge = await tx.get<VaultChallenge>('challenge', challengeId)
    if (!challenge || challenge.clientId !== client.id || challenge.expiresAt <= tx.now() || challenge.credentialVersion !== tx.authority.credentialVersion) denied()
    return { method, client, challenge }
  }
  async providerBegin(identity: VaultIdentity, clientId: string, origin: string, challengeId: string): Promise<ProviderStart> {
    const { method } = await this.store.transaction(identity, async tx => {
      const context = await this.providerContext(tx, identity, clientId, origin, challengeId)
      await tx.limit('provider', 300_000, 5)
      return context
    })
    if (!this.provider) unavailable()
    return this.provider.begin(identity, method, this.entropy.digest(challengeId))
  }
  /** Verifies the provider return outside any transaction; a failed or unavailable proof burns the challenge (fail closed). */
  async providerComplete(identity: VaultIdentity, clientId: string, origin: string, challengeId: string, input: ProviderProofInput): Promise<{ totpRequired: boolean }> {
    const { method } = await this.store.transaction(identity, tx => this.providerContext(tx, identity, clientId, origin, challengeId))
    if (!this.provider) unavailable()
    let proof: { mfa: boolean } | null = null
    try { proof = await this.provider.complete(identity, method, this.entropy.digest(challengeId), input) } catch { proof = null }
    if (!proof) {
      await this.store.transaction(identity, async tx => {
        await tx.remove('challenge', challengeId)
        await tx.audit({ type: 'UNLOCK_DENIED', clientId, policyVersion: tx.authority.policy.version, reasonCode: 'PROVIDER_PROOF_FAILED' })
      })
      reauthFailed()
    }
    const mfa = proof.mfa
    await this.store.transaction(identity, async tx => {
      const { client, challenge } = await this.providerContext(tx, identity, clientId, origin, challengeId)
      await tx.put('provider', challengeId, { clientId: client.id, mfa }, challenge.expiresAt)
    })
    return { totpRequired: !mfa }
  }
  async unlockProvider(identity: VaultIdentity, clientId: string, origin: string, challengeId: string, otp: string | undefined): Promise<{ sessionId: string; idleUntil: number; expiresAt: number; serverNow: number; proofUntil: number }> {
    const proof = await this.store.transaction(identity, async tx => {
      const { client, challenge } = await this.providerContext(tx, identity, clientId, origin, challengeId)
      const stored = await tx.get<{ clientId: string; mfa: boolean }>('provider', challengeId)
      // Burn challenge and proof in a committed transaction before deciding; failures cannot be replayed.
      await tx.remove('challenge', challengeId)
      if (stored) await tx.remove('provider', challengeId)
      return { authority: tx.authority, expiresAt: challenge.expiresAt, valid: stored?.clientId === client.id, mfa: stored?.mfa === true }
    })
    if (!proof.valid || (!proof.mfa && !this.reauth.verifySecondFactor(otp ?? '', proof.authority))) {
      await this.store.transaction(identity, tx => tx.audit({ type: 'UNLOCK_DENIED', clientId, policyVersion: tx.authority.policy.version }))
      // A proof that belongs to another client is a forged/mixed request, not a mistyped credential.
      if (!proof.valid) denied()
      reauthFailed()
    }
    return this.openSession(identity, clientId, origin, proof)
  }
  private async openSession(identity: VaultIdentity, clientId: string, origin: string, proof: { authority: VaultTransaction['authority']; expiresAt: number }): Promise<{ sessionId: string; idleUntil: number; expiresAt: number; serverNow: number; proofUntil: number }> {
    return this.store.transaction(identity, async tx => {
      const client = await this.client(tx, clientId, identity, origin)
      if (proof.expiresAt <= tx.now() || proof.authority.credentialVersion !== tx.authority.credentialVersion) denied()
      // One active session per client. A new unlock invalidates all previous grants via session removal.
      await tx.remove('session', this.entropy.digest(clientId))
      const sessionId = this.entropy.token(), expiresAt = Math.min(tx.now() + 1_800_000, client.expiresAt, tx.authority.validUntil)
      const session: VaultSession = { clientId: client.id, policyVersion: tx.authority.policy.version, credentialVersion: tx.authority.credentialVersion,
        proofAt: tx.now(), idleUntil: Math.min(tx.now() + 300_000, expiresAt), expiresAt }
      await tx.put('session', client.id, { ...session, sessionId: this.entropy.digest(sessionId) }, expiresAt)
      await tx.audit({ type: 'VAULT_UNLOCKED', clientId, policyVersion: tx.authority.policy.version })
      // NA-0186: the client mirrors the tenant's reveal/copy window; the server still enforces it on every grant.
      const proofUntil = Math.min(session.proofAt + operationProofWindowMs(tx.authority.policy), expiresAt)
      return { sessionId, idleUntil: session.idleUntil, expiresAt, serverNow: tx.now(), proofUntil }
    })
  }
  private async session(tx: VaultTransaction, client: VaultClient, sessionId: string): Promise<VaultSession> {
    const s = await tx.get<VaultSession & { sessionId: string }>('session', client.id)
    assertSession(s, client, tx.authority, tx.now())
    if (s.sessionId !== this.entropy.digest(sessionId)) throw new VaultError('VAULT_LOCKED', 423)
    return s
  }
  async lock(identity: VaultIdentity, clientId: string, origin: string): Promise<void> {
    await this.store.transaction(identity, async tx => {
      const existing = await tx.get<VaultClient>('client', clientId)
      if (!existing) return
      if (origin !== tx.authority.policy.origin) denied()
      // Delete client as well: all its challenges and grants become unusable, even after a new bootstrap.
      await tx.remove('session', this.entropy.digest(clientId))
      await tx.remove('client', clientId)
      await tx.audit({ type: 'VAULT_LOCKED', clientId, policyVersion: tx.authority.policy.version })
    })
  }
  async current(identity: VaultIdentity, clientId: string, origin: string): Promise<{ serverNow: number; state: 'LOCKED' | 'UNLOCKED'; idleUntil?: number; expiresAt?: number }> {
    return this.store.transaction(identity, async tx => {
      const client = await this.client(tx, clientId, identity, origin)
      const s = await tx.get<VaultSession>('session', client.id)
      try { assertSession(s, client, tx.authority, tx.now()) } catch { return { state: 'LOCKED', serverNow: tx.now() } }
      return { state: 'UNLOCKED', idleUntil: s.idleUntil, expiresAt: s.expiresAt, serverNow: tx.now() }
    })
  }
  async request(identity: VaultIdentity, clientId: string, origin: string, sessionId: string, action: VaultAction, secretId: number, recipient: VaultOperation['recipient']): Promise<{ operationId: string; expiresAt: number; serverNow: number; context: VaultEnvelopeContext; state: 'AUTHORIZED' }> {
    // Admission is committed independently; denied item/key attempts still consume quota.
    await this.store.transaction(identity, async tx => {
      await this.client(tx, clientId, identity, origin)
      await tx.limit('operations', 60_000, 30)
      await tx.limit('tenant:operations', 60_000, tx.authority.policy.tenantQuota)
    })
    const recipientThumbprint = await this.envelope.validate(recipient)
    return this.store.transaction(identity, async tx => {
      const client = await this.client(tx, clientId, identity, origin)
      const session = await this.session(tx, client, sessionId)
      const secret = await tx.secret(secretId, action)
      const operationId = this.entropy.token(), expiresAt = grantDeadline(session, client, tx.now(), tx.authority.validUntil, operationProofWindowMs(tx.authority.policy))
      const op: VaultOperation = { clientId: client.id, sessionId: this.entropy.digest(sessionId), action, secretId, secretVersion: secret.version, recipient, recipientThumbprint,
        policyVersion: tx.authority.policy.version, expiresAt, state: 'AUTHORIZED' }
      await tx.put('operation', operationId, op, expiresAt)
      await tx.put('session', client.id, { ...session, sessionId: this.entropy.digest(sessionId), idleUntil: Math.min(tx.now() + 300_000, session.expiresAt) }, session.expiresAt)
      await tx.audit({ type: 'OPERATION_AUTHORIZED', clientId, operationId, action, secretId, policyVersion: op.policyVersion })
      return { operationId, expiresAt, state: 'AUTHORIZED', serverNow: tx.now(), context: vaultEnvelopeContext(identity, operationId, op, origin) }
    })
  }
  async consume(identity: VaultIdentity, clientId: string, origin: string, sessionId: string, operationId: string): Promise<{ envelope: string }> {
    const release = await this.store.transaction(identity, async tx => {
      const client = await this.client(tx, clientId, identity, origin)
      const session = await this.session(tx, client, sessionId)
      const op = await tx.get<VaultOperation>('operation', operationId)
      if (!op || op.clientId !== this.entropy.digest(clientId) || op.sessionId !== this.entropy.digest(sessionId) || op.state !== 'AUTHORIZED' || op.expiresAt <= tx.now()
        || op.policyVersion !== tx.authority.policy.version) unavailable()
      const deadline = Math.min(op.expiresAt, grantDeadline(session, client, tx.now(), tx.authority.validUntil, operationProofWindowMs(tx.authority.policy)))
      if (deadline < op.expiresAt) unavailable() // An authorized envelope context is immutable.
      const secret = await tx.secret(op.secretId, op.action)
      if (secret.version !== op.secretVersion) unavailable()
      const envelope = await this.envelope.seal(op.recipient, vaultEnvelopeContext(identity, operationId, op, origin), secret)
      if (tx.now() >= deadline) unavailable()
      await tx.put('operation', operationId, { ...op, state: 'CONSUMED' }, op.expiresAt)
      await tx.audit({ type: 'DELIVERY_RELEASE_COMMITTED', clientId, operationId, action: op.action, secretId: op.secretId, policyVersion: op.policyVersion })
      return { envelope, origin: client.origin, expiresAt: deadline }
    })
    // A lost response or failed post-commit check NEVER reopens the grant.
    await this.origin.assert(release.origin, identity)
    if (this.now() >= release.expiresAt) unavailable()
    return { envelope: release.envelope }
  }
  /** Read without a vault session (e.g. "is this user a vault manager?"): exact policy origin and a per-user limit. */
  async inspect<T>(identity: VaultIdentity, origin: string, limitKey: string, run: (tx: VaultTransaction) => Promise<T>): Promise<T> {
    return this.store.transaction(identity, async tx => {
      if (origin !== tx.authority.policy.origin) denied()
      await tx.limit(limitKey, 60_000, 30)
      return run(tx)
    })
  }
  async administer<T>(identity: VaultIdentity, clientId: string, origin: string, sessionId: string, run: (tx: VaultTransaction) => Promise<T>): Promise<T> {
    return this.confirmed(identity, clientId, origin, sessionId, 'administration', tx => run(tx))
  }
  /** Unlocked session with a step-up proof younger than 60 s; the portal client is handed to the decision. */
  async confirmed<T>(identity: VaultIdentity, clientId: string, origin: string, sessionId: string, limitKey: string,
    run: (tx: VaultTransaction, client: VaultClient) => Promise<T>): Promise<T> {
    return this.store.transaction(identity, async tx => {
      const client = await this.client(tx, clientId, identity, origin)
      const session = await this.session(tx, client, sessionId)
      const deadline = grantDeadline(session, client, tx.now(), tx.authority.validUntil)
      await tx.limit(limitKey, 60_000, 10)
      const result = await run(tx, client)
      // All SQL decisions/writes remain locked and uncommitted at this authorization point.
      await this.origin.assert(client.origin, identity)
      if (tx.now() >= deadline) unavailable()
      return result
    })
  }
  async recordDenial(identity: VaultIdentity, reasonCode: string): Promise<void> {
    await this.store.transaction(identity, async tx => {
      await tx.limit('denial-audit', 60_000, 5)
      await tx.audit({ type: 'OPERATION_DENIED', reasonCode, policyVersion: tx.authority.policy.version })
    })
  }
  async operation(identity: VaultIdentity, clientId: string, origin: string, operationId: string, cancel = false): Promise<{ state: string }> {
    return this.store.transaction(identity, async tx => {
      await this.client(tx, clientId, identity, origin)
      const op = await tx.get<VaultOperation>('operation', operationId)
      if (!op || op.clientId !== this.entropy.digest(clientId)) unavailable()
      if (cancel && op.state === 'AUTHORIZED') {
        await tx.put('operation', operationId, { ...op, state: 'CANCELLED' }, op.expiresAt)
        await tx.audit({ type: 'OPERATION_CANCELLED', clientId, operationId, policyVersion: op.policyVersion })
        return { state: 'CANCELLED' }
      }
      return { state: op.expiresAt <= tx.now() && op.state === 'AUTHORIZED' ? 'EXPIRED' : op.state }
    })
  }
}
