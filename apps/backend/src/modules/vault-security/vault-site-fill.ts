import { VaultSiteFillAuthorizeSchema, VaultSiteFillConsumeSchema, type VaultSiteFillAuthorize, type VaultSiteFillBinding, type VaultSiteFillConsume } from '@nodeaccess/shared'
import { operationProofWindowMs, VaultError, type VaultIdentity, type VaultSecret } from './vault-domain.js'
import type { ExtensionAccess } from './vault-extension-domain.js'
import type { EnvelopeSealer, VaultEntropy, VaultTransaction } from './vault-ports.js'

export interface FillSite { secret: VaultSecret; username: string; origins: string[] }
export interface FillAccess { identity: VaultIdentity; access: ExtensionAccess; jkt: string; token: string }
export interface SiteFillRelease {
  mode: 'password' | 'both';
  envelope: string; username: string; serverNow: number;
  context: { version: 1; operationId: string; tenantId: number; userId: number; clientId: string; action: 'fill'; itemRef: string;
    recipientThumbprint: string; policyVersion: number; secretVersion: string; origin: string; expiresAt: number }
}
interface FillOperation {
  generation: string;
  kind: 'site-fill'; state: 'AUTHORIZED' | 'CONSUMED'; clientId: string; accessHash: string;
  siteId: number; siteVersion: number; secretVersion: string; username: string; binding: VaultSiteFillBinding;
  policyVersion: number; expiresAt: number; recipient: VaultSiteFillAuthorize['recipient']; recipientThumbprint: string
}
const fail = (): never => { throw new VaultError('SITE_FILL_UNAVAILABLE', 403) }
const sameDocument = (a: VaultSiteFillBinding, b: VaultSiteFillBinding): boolean =>
  a.mode === b.mode && a.origin === b.origin && a.tabId === b.tabId && a.frameId === b.frameId && a.documentId === b.documentId

/** Runs inside extension admission's transaction. Passwords leave only in a sealed envelope. */
export class VaultSiteFill {
  constructor(private readonly enabled: () => boolean, private readonly entropy: VaultEntropy, private readonly envelope: EnvelopeSealer) {}

  private async check(tx: VaultTransaction, ctx: FillAccess, granted: () => Promise<boolean>): Promise<number> {
    if (!this.enabled() || !await granted()) fail()
    const proof = ctx.access.proofAt
    const deadline = Math.min(ctx.access.expiresAt, tx.authority.validUntil,
      (proof ?? 0) + operationProofWindowMs(tx.authority.policy))
    if (proof === undefined || proof > tx.now() || deadline <= tx.now()) throw new VaultError('VAULT_STEP_UP_REQUIRED', 423)
    return deadline
  }

  async authorize(tx: VaultTransaction, ctx: FillAccess, raw: VaultSiteFillAuthorize,
    granted: () => Promise<boolean>, read: (id: number, version: number, origin: string) => Promise<FillSite>): Promise<{ operation: string; expiresAt: number; serverNow: number }> {
    const input = VaultSiteFillAuthorizeSchema.parse(raw)
    const deadline = await this.check(tx, ctx, granted)
    const generation = await tx.siteFillGeneration?.()
    if (!generation) return fail()
    await tx.limit('site-fill', 60_000, 30)
    await tx.limit('tenant:operations', 60_000, tx.authority.policy.tenantQuota)
    const item = await read(input.siteId, input.siteVersion, input.binding.origin)
    if (!item.origins.includes(input.binding.origin)) fail()
    const recipientThumbprint = await this.envelope.validate(input.recipient)
    const operation = this.entropy.token(), expiresAt = Math.min(tx.now() + 30_000, deadline)
    const record: FillOperation = { generation, kind: 'site-fill', state: 'AUTHORIZED', clientId: this.entropy.digest(`extension:${ctx.jkt}`),
      accessHash: this.entropy.digest(ctx.token), siteId: input.siteId, siteVersion: input.siteVersion, secretVersion: item.secret.version, username: item.username,
      binding: input.binding, policyVersion: tx.authority.policy.version, expiresAt, recipient: input.recipient, recipientThumbprint }
    await tx.put('operation', operation, record, expiresAt)
    await tx.audit({ type: 'SITE_FILL_AUTHORIZED', operationId: operation, clientId: record.clientId, policyVersion: record.policyVersion, device: ctx.jkt })
    return { operation, expiresAt, serverNow: tx.now() }
  }

  async consume(tx: VaultTransaction, ctx: FillAccess, raw: VaultSiteFillConsume,
    granted: () => Promise<boolean>, read: (id: number, version: number, origin: string) => Promise<FillSite>): Promise<SiteFillRelease | { mode: 'username'; username: string; operation: string; binding: VaultSiteFillBinding; expiresAt: number; serverNow: number }> {
    const input = VaultSiteFillConsumeSchema.parse(raw)
    const deadline = await this.check(tx, ctx, granted)
    const generation = await tx.siteFillGeneration?.()
    if (!generation) return fail()
    const op = await tx.get<FillOperation>('operation', input.operation)
    if (!op || op.generation !== generation || op.kind !== 'site-fill' || op.state !== 'AUTHORIZED' || op.expiresAt <= tx.now()
      || op.policyVersion !== tx.authority.policy.version || op.accessHash !== this.entropy.digest(ctx.token)
      || op.clientId !== this.entropy.digest(`extension:${ctx.jkt}`) || !sameDocument(op.binding, input.binding)) return fail()
    // ACL, origins and version are read again while the authority and operation are locked.
    const item = await read(op.siteId, op.siteVersion, op.binding.origin)
    if (!item.origins.includes(op.binding.origin) || item.secret.version !== op.secretVersion || item.username !== op.username) fail()
    const context = { version: 1 as const, operationId: input.operation, tenantId: ctx.identity.tenantId, userId: ctx.identity.userId,
      clientId: op.clientId, action: 'fill' as const, itemRef: `site:${op.siteId}:${op.binding.mode}`, recipientThumbprint: op.recipientThumbprint,
      policyVersion: op.policyVersion, secretVersion: op.secretVersion, origin: op.binding.origin, expiresAt: Math.min(op.expiresAt, deadline) }
    // Username-only deliberately bypasses the sealer: it must never decrypt the password.
    const envelope = op.binding.mode === 'username' ? undefined : await this.envelope.seal(op.recipient, context, item.secret)
    if (!this.enabled() || context.expiresAt <= tx.now()) fail()
    await tx.put('operation', input.operation, { ...op, state: 'CONSUMED' }, op.expiresAt)
    await tx.audit({ type: 'SITE_FILL_RELEASE_COMMITTED', operationId: input.operation, clientId: op.clientId, policyVersion: op.policyVersion, device: ctx.jkt })
    if (op.binding.mode === 'username') return { mode: 'username', username: item.username, operation: input.operation,
      binding: op.binding, expiresAt: context.expiresAt, serverNow: tx.now() }
    return { mode: op.binding.mode, envelope: envelope!, context, username: op.binding.mode === 'both' ? item.username : '', serverNow: tx.now() }
  }
}
