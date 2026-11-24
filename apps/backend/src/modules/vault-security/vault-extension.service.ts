import type { VaultItemSummary, VaultItemKind } from '@nodeaccess/shared'
import { denied, operationProofWindowMs, unavailable, VaultError, type VaultAction, type VaultAuthMethod, type VaultAuthority, type VaultEnvelopeContext, type VaultIdentity, type VaultOperation, type VaultSecret } from './vault-domain.js'
import type { EnvelopeSealer, Reauthentication } from './vault-ports.js'
import type { OriginVerifier, VaultEntropy, VaultStore, VaultTransaction } from './vault-ports.js'
import type { VaultService } from './vault.service.js'
import { extensionRedirectUri, versionAtLeast, type ExtensionAccess, type ExtensionCode, type ExtensionConfig, type ExtensionDeviceRow, type ExtensionLocator, type ExtensionRecords, type ExtensionTrust } from './vault-extension-domain.js'
import { pkceMatches, type DpopNonces, type DpopVerifier } from './vault-extension-dpop.js'

const CODE_TTL_MS = 60_000
const ACCESS_TTL_MS = 1_800_000
const PAGE = 50
/** NA-0193 (decision of the owner, 2026-11-23): a device stays trusted 7 days after its last full consent; 5 wrong codes end it. */
const TRUST_TTL_MS = 7 * 24 * 3_600_000
const TRUST_MAX_FAILURES = 5
const trustKey = (jkt: string): string => `trust:${jkt}`
export interface RenewInput { extensionId: string; otp?: string | undefined }
interface AccessRequest { identity: VaultIdentity; token: string; jkt: string; extensionId: string | null; url: string }
type Renewal = { ok: true; reply: { accessToken: string; tokenType: 'DPoP'; expiresAt: number; serverNow: number } } | { ok: false; error: VaultError }

/** Item listing reuses the Secrets and PEM ACL services; this port only maps their output. */
export interface VaultCatalog { list(identity: VaultIdentity, admin: boolean): Promise<VaultItemSummary[]> }
export interface ExtensionRequest {
  /** Value of the `Origin` header; must be chrome-extension://<allowed id>. */
  requestOrigin: unknown
  /** `X-Extension-Version` header. */
  version: unknown
  /** DPoP proof header. */
  proof: unknown
  /** Absolute URL of this request as served (scheme://host/path, no query). */
  url: string
}
export interface AuthorizeInput { extensionId: string; redirectUri: string; state: string; codeChallenge: string; deviceJkt: string; sessionId: string }
export interface TokenInput { code: string; codeVerifier: string; redirectUri: string; extensionId: string }

type Secret = { id: number; alias: string; description: string | null; scope: 'PERSONAL' | 'GROUP' | 'TENANT'; ownerUserId: number | null }
type Pem = { id: number; name: string; createdById: number }
/** Pure projection of the ACL-filtered lists: labels and scope, never values. */
export function catalogSummaries(secrets: readonly Secret[], pems: readonly Pem[], userId: number): VaultItemSummary[] {
  return [
    ...secrets.map((s): VaultItemSummary => ({ kind: 'secret', sourceId: s.id, label: s.alias.slice(0, 200) || `#${s.id}`, description: s.description?.slice(0, 500) ?? null,
      scope: s.scope === 'PERSONAL' && s.ownerUserId === userId ? 'personal' : 'shared', portalPath: `/vault?kind=secret&id=${s.id}` })),
    ...pems.map((p): VaultItemSummary => ({ kind: 'pem', sourceId: p.id, label: p.name.slice(0, 200) || `#${p.id}`, description: null,
      scope: p.createdById === userId ? 'personal' : 'shared', portalPath: `/vault?kind=pem&id=${p.id}` })),
  ]
}
export function pageOf(items: readonly VaultItemSummary[], q: string | undefined, kind: VaultItemKind | undefined, cursor: string | undefined): { items: VaultItemSummary[]; nextCursor: string | null } {
  const search = (q ?? '').trim().toLocaleLowerCase()
  const filtered = items.filter(i => (!kind || i.kind === kind) && (!search || i.label.toLocaleLowerCase().includes(search) || (i.description ?? '').toLocaleLowerCase().includes(search)))
    .sort((a, b) => a.label.localeCompare(b.label) || a.kind.localeCompare(b.kind) || a.sourceId - b.sourceId)
  const start = cursor ? Number(cursor) : 0
  const page = filtered.slice(start, start + PAGE)
  return { items: page, nextCursor: start + PAGE < filtered.length ? String(start + PAGE) : null }
}

/**
 * NA-0183 slice E1. The extension is a public client: consent happens in the portal inside an unlocked vault
 * session with a fresh step-up (NA-0184), the code is PKCE S256 + bound to the device key (DPoP jkt), and the
 * 30-minute authorization (no refresh) dies with the central session that consented.
 */
export class VaultExtensionService {
  constructor(private readonly vault: VaultService, private readonly store: VaultStore, private readonly locator: ExtensionLocator,
    private readonly origin: OriginVerifier, private readonly dpop: DpopVerifier, readonly nonces: DpopNonces,
    private readonly entropy: VaultEntropy, private readonly catalog: VaultCatalog, private readonly config: ExtensionConfig, private readonly now = Date.now,
    /** NA-0193: NodeAccess TOTP check for renewal with the authenticator code; absent = never accepted (fail closed). */
    private readonly secondFactor: Pick<Reauthentication, 'verifySecondFactor'> = { verifySecondFactor: () => false },
    /** NA-0195: JWE sealing for reveal/copy releases; absent = releases unavailable. */
    private readonly envelope: EnvelopeSealer = { validate: () => unavailable(), seal: () => unavailable() }) {}

  private enabled(): void { if (!this.config.enabled) throw new VaultError('EXTENSION_DISABLED', 404) }
  private allowed(extensionId: string, redirectUri: string): void {
    if (!this.config.extensionIds.includes(extensionId) || redirectUri !== extensionRedirectUri(extensionId)) throw new VaultError('EXTENSION_CLIENT_INVALID', 400)
  }
  /**
   * Origin and minimum version are checked before any token is looked up. Chromium sends `Origin` on the
   * extension's POSTs but omits it on GETs made with host permissions, so it is optional only on GET; when
   * present it must be an allowed extension. The binding itself is DPoP + authorization + device.
   */
  private client(req: ExtensionRequest, originRequired: boolean): string | null {
    this.enabled()
    if (!versionAtLeast(typeof req.version === 'string' ? req.version : undefined, this.config.minVersion)) throw new VaultError('EXTENSION_UPGRADE_REQUIRED', 426)
    if (req.requestOrigin === undefined && !originRequired) return null
    const match = typeof req.requestOrigin === 'string' ? /^chrome-extension:\/\/([a-p]{32})$/.exec(req.requestOrigin) : null
    if (!match?.[1] || !this.config.extensionIds.includes(match[1])) throw new VaultError('EXTENSION_CLIENT_INVALID', 400)
    return match[1]
  }
  private records(tx: VaultTransaction): ExtensionRecords { return tx.extension ?? unavailable() }
  private async deny(identity: VaultIdentity, reasonCode: string, device?: string): Promise<void> {
    try {
      await this.vault.admitted(() => this.store.transaction(identity, async tx => {
        await tx.limit('extension-denial-audit', 60_000, 5)
        await tx.audit({ type: 'EXTENSION_DENIED', reasonCode, policyVersion: tx.authority.policy.version, ...(device ? { device } : {}) })
      }))
    } catch { /* A denial stays a denial when its diagnostic audit is unavailable or rate limited. */ }
  }

  /** Portal consent: unlocked session, step-up proof younger than 60 s, permission `extension`. */
  async authorize(identity: VaultIdentity, clientId: string, origin: string, input: AuthorizeInput): Promise<{ code: string; expiresAt: number; serverNow: number }> {
    this.enabled()
    this.allowed(input.extensionId, input.redirectUri)
    const result = await this.vault.confirmed(identity, clientId, origin, input.sessionId, 'extension-authorize', async (tx, client) => {
      const ext = this.records(tx)
      if (!await ext.entitled()) return null
      // One consent per step-up: the portal vault session ends here, server side, whatever the client does next.
      await tx.remove('session', client.id)
      const code = this.entropy.token(), expiresAt = Math.min(tx.now() + CODE_TTL_MS, client.origin.expiresAt, tx.authority.validUntil)
      const value: ExtensionCode = { sessionVersion: identity.sessionVersion, extensionId: input.extensionId, redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge, origin: client.origin, policyVersion: tx.authority.policy.version, expiresAt }
      await ext.put('code', code, input.deviceJkt, value, expiresAt)
      await tx.audit({ type: 'EXTENSION_AUTHORIZED', clientId, device: input.deviceJkt, policyVersion: tx.authority.policy.version })
      return { code, expiresAt, serverNow: tx.now() }
    })
    if (!result) { await this.deny(identity, 'NOT_ENTITLED', input.deviceJkt); throw new VaultError('EXTENSION_FORBIDDEN', 403) }
    return result
  }

  /** Public code exchange. The code is burned in its own committed transaction before any other check. */
  async token(req: ExtensionRequest, input: TokenInput): Promise<{ accessToken: string; tokenType: 'DPoP'; expiresAt: number; serverNow: number }> {
    const extensionId = this.client(req, true)
    if (extensionId !== input.extensionId) throw new VaultError('EXTENSION_CLIENT_INVALID', 400)
    this.allowed(input.extensionId, input.redirectUri)
    const jkt = await this.dpop.verify(req.proof, { method: 'POST', url: req.url })
    const identity = await this.locator.locate('code', input.code)
    if (!identity) throw new VaultError('EXTENSION_GRANT_INVALID', 400)
    const taken = await this.store.transaction(identity, tx => this.records(tx).take<ExtensionCode>('code', input.code))
    const code = taken?.value
    if (!taken || !code || code.expiresAt <= this.now() || code.extensionId !== input.extensionId || code.redirectUri !== input.redirectUri
      || !pkceMatches(input.codeVerifier, code.codeChallenge) || taken.jkt !== jkt) {
      await this.deny(identity, 'GRANT_INVALID', jkt)
      throw new VaultError('EXTENSION_GRANT_INVALID', 400)
    }
    try {
      return await this.store.transaction(identity, async tx => {
        // The device becomes ACTIVE only when its own key completes the exchange, not at consent.
        await this.records(tx).activateDevice(jkt, code.extensionId)
        await this.admit(tx, identity, code, jkt, req.url)
        await tx.limit('extension-token', 3_600_000, 20)
        const accessToken = this.entropy.token()
        const expiresAt = Math.min(tx.now() + ACCESS_TTL_MS, code.origin.expiresAt, tx.authority.validUntil)
        const access: ExtensionAccess = { sessionVersion: identity.sessionVersion, extensionId: code.extensionId, origin: code.origin, policyVersion: code.policyVersion, expiresAt }
        await this.records(tx).put('access', accessToken, jkt, access, expiresAt)
        // NA-0193: a full consent (re)starts the 7-day trust of this device, bound to the consenting central session.
        await this.records(tx).releaseTrust(jkt)
        const trustUntil = Math.min(tx.now() + TRUST_TTL_MS, tx.authority.validUntil)
        const trust: ExtensionTrust = { sessionVersion: identity.sessionVersion, extensionId: code.extensionId, origin: code.origin, failures: 0, expiresAt: trustUntil }
        await this.records(tx).put('trust', trustKey(jkt), jkt, trust, trustUntil)
        await tx.audit({ type: 'EXTENSION_CLIENT_REGISTERED', clientId: `extension-access:${this.entropy.digest(accessToken)}`, device: jkt, policyVersion: tx.authority.policy.version })
        return { accessToken, tokenType: 'DPoP' as const, expiresAt, serverNow: tx.now() }
      })
    } catch (error) { return this.denied(identity, error, jkt) }
  }

  /** Every check of contract §4, under the same lock as the authority read. */
  private async admit(tx: VaultTransaction, identity: VaultIdentity, grant: ExtensionCode | ExtensionAccess, jkt: string, url: string): Promise<void> {
    const authority: VaultAuthority = tx.authority
    if (grant.policyVersion !== authority.policy.version || grant.sessionVersion !== identity.sessionVersion || new URL(url).origin !== authority.policy.origin
      || (grant.origin !== null && authority.methods[grant.origin.authMethod] !== true)) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    const ext = this.records(tx)
    if (!await ext.entitled()) throw new VaultError('EXTENSION_FORBIDDEN', 403)
    const device: ExtensionDeviceRow | null = await ext.device(jkt)
    if (device?.state !== 'ACTIVE' || device.extensionId !== grant.extensionId) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    // An authorization renewed with the authenticator code (NA-0193) is not tied to a central session, but its login
    // method still has to be allowed by the tenant policy and the external-methods flag.
    if (grant.origin === null) {
      const method = 'method' in grant ? grant.method : undefined
      if (!method || !this.methodAllowed(method, authority)) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
      return
    }
    try { await this.origin.assert(grant.origin, identity) } catch { throw new VaultError('EXTENSION_UNAUTHORIZED', 401) }
  }

  /**
   * NA-0193: renewal by a trusted device, proven by its DPoP key. Without `otp` only while the consenting central
   * session lives (else EXTENSION_REAUTH_REQUIRED); with `otp` the NodeAccess TOTP. Wrong codes are counted in a
   * committed transaction before the error is returned; the fifth ends the trust (full consent again).
   */
  async renew(req: ExtensionRequest, input: RenewInput): Promise<{ accessToken: string; tokenType: 'DPoP'; expiresAt: number; serverNow: number }> {
    const extensionId = this.client(req, true)
    if (extensionId !== input.extensionId) throw new VaultError('EXTENSION_CLIENT_INVALID', 400)
    const jkt = await this.dpop.verify(req.proof, { method: 'POST', url: req.url })
    const identity = await this.locator.locate('trust', trustKey(jkt))
    if (!identity) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    let outcome: Renewal
    try {
      outcome = await this.store.transaction(identity, async (tx): Promise<Renewal> => {
        await tx.limit('extension-renew', 60_000, 10)
        const ext = this.records(tx)
        const row = await ext.take<ExtensionTrust>('trust', trustKey(jkt))
        const trust = row?.value
        if (!row || !trust || row.jkt !== jkt || trust.expiresAt <= tx.now() || trust.extensionId !== input.extensionId || trust.sessionVersion !== identity.sessionVersion) {
          return { ok: false, error: new VaultError('EXTENSION_UNAUTHORIZED', 401) }
        }
        const keep = (failures: number): Promise<void> => ext.put('trust', trustKey(jkt), jkt, { ...trust, failures }, trust.expiresAt)
        if (!await ext.entitled()) { await keep(trust.failures); return { ok: false, error: new VaultError('EXTENSION_FORBIDDEN', 403) } }
        const device = await ext.device(jkt)
        if (device?.state !== 'ACTIVE' || device.extensionId !== trust.extensionId) return { ok: false, error: new VaultError('EXTENSION_UNAUTHORIZED', 401) }
        // Before any code check: a limit hit never tells whether the code was right.
        await tx.limit('extension-token', 3_600_000, 20)
        if (!this.methodAllowed(trust.origin.authMethod, tx.authority)) { await keep(trust.failures); return { ok: false, error: new VaultError('EXTENSION_UNAUTHORIZED', 401) } }
        let viaSession = false
        if (input.otp === undefined) {
          try { await this.origin.assert(trust.origin, identity); viaSession = tx.authority.methods[trust.origin.authMethod] === true } catch { viaSession = false }
          if (!viaSession) { await keep(trust.failures); return { ok: false, error: new VaultError('EXTENSION_REAUTH_REQUIRED', 401) } }
        } else if (!this.secondFactor.verifySecondFactor(input.otp, tx.authority)) {
          const failures = trust.failures + 1
          if (failures < TRUST_MAX_FAILURES) await keep(failures)
          await tx.audit({ type: 'EXTENSION_RENEW_DENIED', device: jkt, reasonCode: failures < TRUST_MAX_FAILURES ? 'OTP_INVALID' : 'TRUST_ENDED', policyVersion: tx.authority.policy.version })
          return { ok: false, error: failures < TRUST_MAX_FAILURES ? new VaultError('VAULT_REAUTH_FAILED', 403) : new VaultError('EXTENSION_UNAUTHORIZED', 401) }
        }
        await keep(0)
        const accessToken = this.entropy.token()
        const expiresAt = Math.min(tx.now() + ACCESS_TTL_MS, trust.expiresAt, tx.authority.validUntil, viaSession ? trust.origin.expiresAt : Number.MAX_SAFE_INTEGER)
        const access: ExtensionAccess = { sessionVersion: identity.sessionVersion, extensionId: trust.extensionId, origin: viaSession ? trust.origin : null,
          policyVersion: tx.authority.policy.version, expiresAt, ...(viaSession ? {} : { method: trust.origin.authMethod }) }
        await ext.put('access', accessToken, jkt, access, expiresAt)
        await ext.touchDevice(jkt)
        await tx.audit({ type: 'EXTENSION_RENEWED', device: jkt, reasonCode: viaSession ? 'SESSION' : 'OTP', policyVersion: tx.authority.policy.version })
        return { ok: true, reply: { accessToken, tokenType: 'DPoP', expiresAt, serverNow: tx.now() } }
      })
    } catch (error) { return this.denied(identity, error, jkt) }
    if (!outcome.ok) {
      if (outcome.error.code === 'EXTENSION_FORBIDDEN' || outcome.error.code === 'EXTENSION_UNAUTHORIZED') await this.deny(identity, outcome.error.code, jkt)
      throw outcome.error
    }
    return outcome.reply
  }
  private methodAllowed(method: VaultAuthMethod, authority: VaultAuthority): boolean {
    return authority.methods[method] === true && (this.origin.allows ? this.origin.allows(method) : method === 'local')
  }
  private async denied(identity: VaultIdentity, error: unknown, jkt: string): Promise<never> {
    const code = error instanceof VaultError ? error.code : 'VAULT_DEPENDENCY_UNAVAILABLE'
    if (code === 'EXTENSION_FORBIDDEN' || code === 'EXTENSION_UNAUTHORIZED' || code === 'VAULT_FORBIDDEN') await this.deny(identity, code, jkt)
    if (code === 'VAULT_FORBIDDEN') throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    throw error
  }

  /**
   * DPoP-bound authorization for one API request, in one transaction with `run` (every check of `admit` under the
   * same lock). POST requires the extension Origin. Denials of the authorization map to 401; others pass through.
   */
  /** DPoP proof (single use) and the owner claimed by the authorization; verified once per request. */
  private async authenticate(req: ExtensionRequest, authorization: unknown, method: 'GET' | 'POST'): Promise<AccessRequest> {
    const extensionId = this.client(req, method === 'POST')
    const match = typeof authorization === 'string' ? /^DPoP ([A-Za-z0-9_-]{43})$/.exec(authorization) : null
    if (!match?.[1]) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    const token = match[1]
    const jkt = await this.dpop.verify(req.proof, { method, url: req.url, accessToken: token })
    const identity = await this.locator.locate('access', token)
    if (!identity) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    return { identity, token, jkt, extensionId, url: req.url }
  }
  /** One transaction under a valid authorization: every check of `admit` under the same lock, then `run`. */
  private async inAccess<T>(a: AccessRequest, run: (tx: VaultTransaction, ctx: { identity: VaultIdentity; access: ExtensionAccess; jkt: string; token: string }) => Promise<T>): Promise<T> {
    try {
      return await this.store.transaction(a.identity, async tx => {
        const row = await this.records(tx).get<ExtensionAccess>('access', a.token)
        if (!row || row.jkt !== a.jkt || row.value.expiresAt <= tx.now() || (a.extensionId !== null && row.value.extensionId !== a.extensionId)) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
        await this.admit(tx, a.identity, row.value, a.jkt, a.url)
        await tx.limit('extension-api', 60_000, 120)
        const device = await this.records(tx).device(a.jkt)
        if (!device?.lastUsedAt || device.lastUsedAt < tx.now() - 60_000) await this.records(tx).touchDevice(a.jkt)
        return run(tx, { identity: a.identity, access: row.value, jkt: a.jkt, token: a.token })
      })
    } catch (error) { return this.denied(a.identity, error, a.jkt) }
  }
  private async withAccess<T>(req: ExtensionRequest, authorization: unknown, method: 'GET' | 'POST',
    run: (tx: VaultTransaction, ctx: { identity: VaultIdentity; access: ExtensionAccess; jkt: string; token: string }) => Promise<T>): Promise<T> {
    return this.inAccess(await this.authenticate(req, authorization, method), run)
  }
  private resource(req: ExtensionRequest, authorization: unknown): Promise<{ identity: VaultIdentity; authority: VaultAuthority; access: ExtensionAccess }> {
    return this.withAccess(req, authorization, 'GET', (tx, c) => Promise.resolve({ identity: c.identity, authority: tx.authority, access: c.access }))
  }

  /**
   * NA-0195 (E2): fresh identity proof in the extension — the NodeAccess authenticator code (the central password never
   * enters the extension, contract §4). Valid for the tenant's reveal/copy window (NA-0186) and only for this authorization.
   */
  async unlock(req: ExtensionRequest, authorization: unknown, input: { otp: string }): Promise<{ proofUntil: number; serverNow: number }> {
    const outcome = await this.withAccess(req, authorization, 'POST', async (tx, c) => {
      await tx.limit('extension-unlock', 300_000, 5)
      const ext = this.records(tx)
      if (!this.secondFactor.verifySecondFactor(input.otp, tx.authority)) {
        // Wrong codes share the device-trust counter (NA-0193): the fifth ends the trust and this authorization.
        const row = await ext.take<ExtensionTrust>('trust', trustKey(c.jkt))
        const failures = (row?.value.failures ?? 0) + 1
        const ended = failures >= TRUST_MAX_FAILURES
        if (row && !ended) await ext.put('trust', trustKey(c.jkt), c.jkt, { ...row.value, failures }, row.value.expiresAt)
        if (ended) await ext.dropAccess(c.jkt)
        await tx.audit({ type: 'EXTENSION_UNLOCK_DENIED', device: c.jkt, reasonCode: ended ? 'TRUST_ENDED' : 'OTP_INVALID', policyVersion: tx.authority.policy.version })
        return { ended }
      }
      await ext.take('access', c.token)
      // One instant for the stored proof and the deadline returned, so capabilities report the same proofUntil.
      const proofAt = tx.now()
      await ext.put('access', c.token, c.jkt, { ...c.access, proofAt }, c.access.expiresAt)
      const trust = await ext.take<ExtensionTrust>('trust', trustKey(c.jkt))
      if (trust) await ext.put('trust', trustKey(c.jkt), c.jkt, { ...trust.value, failures: 0 }, trust.value.expiresAt)
      await tx.audit({ type: 'EXTENSION_UNLOCKED', device: c.jkt, policyVersion: tx.authority.policy.version })
      return { proofUntil: Math.min(proofAt + operationProofWindowMs(tx.authority.policy), c.access.expiresAt), serverNow: proofAt }
    })
    // The attempt (limit, counter, audit) is committed before the refusal.
    if ('ended' in outcome) throw outcome.ended ? new VaultError('EXTENSION_UNAUTHORIZED', 401) : new VaultError('VAULT_REAUTH_FAILED', 403)
    return outcome
  }

  /**
   * NA-0195 (E2): one reveal/copy release to the popup's ephemeral RSA key, with the same rules as the portal: tenant
   * policy, per-action grant by two managers, web-eligible item and its scope (`tx.secret`), quotas, a proof younger
   * than the tenant window, JWE bound to its context, audit. Item refusals are 403 and never end the authorization.
   */
  async deliver(req: ExtensionRequest, authorization: unknown, input: { secretId: number; action: VaultAction; recipient: VaultOperation['recipient'] }): Promise<{ envelope: string; context: VaultEnvelopeContext; serverNow: number }> {
    const request = await this.authenticate(req, authorization, 'POST')
    // Admission is committed on its own: refused items and keys still consume quota (as in the portal).
    await this.inAccess(request, async tx => {
      await tx.limit('operations', 60_000, 30)
      await tx.limit('tenant:operations', 60_000, tx.authority.policy.tenantQuota)
    })
    const recipientThumbprint = await this.envelope.validate(input.recipient)
    return this.inAccess(request, async (tx, c) => {
      const proofAt = c.access.proofAt
      if (proofAt === undefined || tx.now() - proofAt > operationProofWindowMs(tx.authority.policy)) throw new VaultError('VAULT_STEP_UP_REQUIRED', 423)
      let secret: VaultSecret
      try { secret = await tx.secret(input.secretId, input.action) } catch (error) {
        if (error instanceof VaultError && error.code === 'VAULT_FORBIDDEN') throw new VaultError('EXTENSION_ITEM_DENIED', 403)
        throw error
      }
      const operationId = this.entropy.token()
      const context: VaultEnvelopeContext = { version: 1, operationId, tenantId: c.identity.tenantId, userId: c.identity.userId,
        clientId: this.entropy.digest(`extension:${c.jkt}`), action: input.action, itemRef: `secret:${input.secretId}`, recipientThumbprint,
        policyVersion: tx.authority.policy.version, secretVersion: secret.version, origin: tx.authority.policy.origin,
        expiresAt: Math.min(tx.now() + 30_000, c.access.expiresAt, proofAt + operationProofWindowMs(tx.authority.policy)) }
      const envelope = await this.envelope.seal(input.recipient, context, secret)
      await tx.audit({ type: 'DELIVERY_RELEASE_COMMITTED', clientId: context.clientId, operationId, action: input.action, secretId: input.secretId, device: c.jkt, policyVersion: context.policyVersion })
      return { envelope, context, serverNow: tx.now() }
    })
  }

  async capabilities(req: ExtensionRequest, authorization: unknown): Promise<object> {
    // NA-0195: reveal/copy are offered when the tenant policy and the user's own two-manager grant allow them; the
    // server still checks each release. `proofUntil` lets the popup skip the code while a proof is fresh.
    return this.withAccess(req, authorization, 'GET', async (tx, c) => {
      const ext = this.records(tx), policy = tx.authority.policy
      const proofUntil = c.access.proofAt === undefined ? null : Math.min(c.access.proofAt + operationProofWindowMs(policy), c.access.expiresAt)
      return { apiVersion: 1, minExtensionVersion: this.config.minVersion, kinds: ['secret', 'pem'],
        features: { reveal: policy.reveal && await ext.granted('reveal'), copy: policy.copy && await ext.granted('copy'), create: false },
        portalOrigin: policy.origin, expiresAt: c.access.expiresAt, serverNow: tx.now(), ...(proofUntil !== null && proofUntil > tx.now() ? { proofUntil } : {}) }
    })
  }

  async items(req: ExtensionRequest, authorization: unknown, query: { q?: string | undefined; kind?: VaultItemKind | undefined; cursor?: string | undefined }): Promise<{ items: VaultItemSummary[]; nextCursor: string | null }> {
    const { identity, authority } = await this.resource(req, authorization)
    return pageOf(await this.catalog.list(identity, authority.role === 'ADMIN'), query.q, query.kind, query.cursor)
  }

  /**
   * NA-0193: "Disconnect" in the extension ends this device's trust and authorizations; the next connection is a full
   * consent. Authenticated like renewal (Origin + DPoP with the device key), so it works with an expired authorization.
   */
  async forget(req: ExtensionRequest, input: { extensionId: string }): Promise<{ state: 'FORGOTTEN' }> {
    const extensionId = this.client(req, true)
    if (extensionId !== input.extensionId) throw new VaultError('EXTENSION_CLIENT_INVALID', 400)
    const jkt = await this.dpop.verify(req.proof, { method: 'POST', url: req.url })
    const identity = await this.locator.locate('trust', trustKey(jkt))
    if (!identity) return { state: 'FORGOTTEN' }
    try {
      await this.store.transaction(identity, async tx => {
        const ext = this.records(tx)
        const row = await ext.take<ExtensionTrust>('trust', trustKey(jkt))
        await ext.dropAccess(jkt)
        if (row) await tx.audit({ type: 'EXTENSION_TRUST_ENDED', device: jkt, reasonCode: 'USER_DISCONNECTED', policyVersion: tx.authority.policy.version })
      })
    } catch (error) { return this.denied(identity, error, jkt) }
    return { state: 'FORGOTTEN' }
  }

  /** Portal: the signed-in user's own devices (metadata only). */
  async devices(identity: VaultIdentity, origin: string): Promise<{ devices: ExtensionDeviceRow[] }> {
    this.enabled()
    return this.store.transaction(identity, async tx => {
      if (origin !== tx.authority.policy.origin) denied()
      return { devices: await this.records(tx).devices() }
    })
  }
  async revokeDevice(identity: VaultIdentity, origin: string, jkt: string): Promise<{ state: 'REVOKED' }> {
    this.enabled()
    await this.store.transaction(identity, async tx => {
      if (origin !== tx.authority.policy.origin || !await this.records(tx).revokeDevice(jkt)) denied()
      await tx.audit({ type: 'DEVICE_REVOKED', device: jkt, policyVersion: tx.authority.policy.version })
    })
    return { state: 'REVOKED' }
  }
}
