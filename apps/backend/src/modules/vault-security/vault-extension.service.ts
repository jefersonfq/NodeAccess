import type { VaultItemSummary, VaultItemKind } from '@nodeaccess/shared'
import { denied, unavailable, VaultError, type VaultAuthority, type VaultIdentity } from './vault-domain.js'
import type { OriginVerifier, VaultEntropy, VaultStore, VaultTransaction } from './vault-ports.js'
import type { VaultService } from './vault.service.js'
import { extensionRedirectUri, versionAtLeast, type ExtensionAccess, type ExtensionCode, type ExtensionConfig, type ExtensionDeviceRow, type ExtensionLocator, type ExtensionRecords } from './vault-extension-domain.js'
import { pkceMatches, type DpopNonces, type DpopVerifier } from './vault-extension-dpop.js'

const CODE_TTL_MS = 60_000
const ACCESS_TTL_MS = 1_800_000
const PAGE = 50

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
    private readonly entropy: VaultEntropy, private readonly catalog: VaultCatalog, private readonly config: ExtensionConfig, private readonly now = Date.now) {}

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
      await ext.activateDevice(input.deviceJkt, input.extensionId)
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
        await this.admit(tx, identity, code, jkt, req.url)
        await tx.limit('extension-token', 3_600_000, 20)
        const accessToken = this.entropy.token()
        const expiresAt = Math.min(tx.now() + ACCESS_TTL_MS, code.origin.expiresAt, tx.authority.validUntil)
        const access: ExtensionAccess = { sessionVersion: identity.sessionVersion, extensionId: code.extensionId, origin: code.origin, policyVersion: code.policyVersion, expiresAt }
        await this.records(tx).put('access', accessToken, jkt, access, expiresAt)
        await tx.audit({ type: 'EXTENSION_CLIENT_REGISTERED', clientId: accessToken, device: jkt, policyVersion: tx.authority.policy.version })
        return { accessToken, tokenType: 'DPoP' as const, expiresAt, serverNow: tx.now() }
      })
    } catch (error) { return this.denied(identity, error, jkt) }
  }

  /** Every check of contract §4, under the same lock as the authority read. */
  private async admit(tx: VaultTransaction, identity: VaultIdentity, grant: ExtensionCode | ExtensionAccess, jkt: string, url: string): Promise<void> {
    const authority: VaultAuthority = tx.authority
    if (grant.policyVersion !== authority.policy.version || grant.sessionVersion !== identity.sessionVersion || new URL(url).origin !== authority.policy.origin
      || authority.methods[grant.origin.authMethod] !== true) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    const ext = this.records(tx)
    if (!await ext.entitled()) throw new VaultError('EXTENSION_FORBIDDEN', 403)
    const device: ExtensionDeviceRow | null = await ext.device(jkt)
    if (device?.state !== 'ACTIVE' || device.extensionId !== grant.extensionId) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    try { await this.origin.assert(grant.origin, identity) } catch { throw new VaultError('EXTENSION_UNAUTHORIZED', 401) }
  }
  private async denied(identity: VaultIdentity, error: unknown, jkt: string): Promise<never> {
    const code = error instanceof VaultError ? error.code : 'VAULT_DEPENDENCY_UNAVAILABLE'
    if (code === 'EXTENSION_FORBIDDEN' || code === 'EXTENSION_UNAUTHORIZED' || code === 'VAULT_FORBIDDEN') await this.deny(identity, code, jkt)
    if (code === 'VAULT_FORBIDDEN') throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    throw error
  }

  /** DPoP-bound authorization for one API request; returns the authority only to build the response. */
  private async resource(req: ExtensionRequest, authorization: unknown): Promise<{ identity: VaultIdentity; authority: VaultAuthority; access: ExtensionAccess }> {
    const extensionId = this.client(req, false)
    const match = typeof authorization === 'string' ? /^DPoP ([A-Za-z0-9_-]{43})$/.exec(authorization) : null
    if (!match?.[1]) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    const token = match[1]
    const jkt = await this.dpop.verify(req.proof, { method: 'GET', url: req.url, accessToken: token })
    const identity = await this.locator.locate('access', token)
    if (!identity) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
    try {
      return await this.store.transaction(identity, async tx => {
        const row = await this.records(tx).get<ExtensionAccess>('access', token)
        if (!row || row.jkt !== jkt || row.value.expiresAt <= tx.now() || (extensionId !== null && row.value.extensionId !== extensionId)) throw new VaultError('EXTENSION_UNAUTHORIZED', 401)
        await this.admit(tx, identity, row.value, jkt, req.url)
        await tx.limit('extension-api', 60_000, 120)
        const device = await this.records(tx).device(jkt)
        if (!device?.lastUsedAt || device.lastUsedAt < tx.now() - 60_000) await this.records(tx).touchDevice(jkt)
        return { identity, authority: tx.authority, access: row.value }
      })
    } catch (error) { return this.denied(identity, error, jkt) }
  }

  async capabilities(req: ExtensionRequest, authorization: unknown): Promise<object> {
    const { authority, access } = await this.resource(req, authorization)
    return { apiVersion: 1, minExtensionVersion: this.config.minVersion, kinds: ['secret', 'pem'], features: { reveal: false, copy: false, create: false },
      portalOrigin: authority.policy.origin, expiresAt: access.expiresAt, serverNow: this.now() }
  }

  async items(req: ExtensionRequest, authorization: unknown, query: { q?: string | undefined; kind?: VaultItemKind | undefined; cursor?: string | undefined }): Promise<{ items: VaultItemSummary[]; nextCursor: string | null }> {
    const { identity, authority } = await this.resource(req, authorization)
    return pageOf(await this.catalog.list(identity, authority.role === 'ADMIN'), query.q, query.kind, query.cursor)
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
