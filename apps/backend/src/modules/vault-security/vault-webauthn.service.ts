/**
 * NA-0198 — Windows Hello / passkey credentials of the signed-in user for unlocking the vault in the portal.
 * Registering and removing need a vault session confirmed less than a minute ago (fresh authorization, contract §5)
 * and are audited; listing needs only the exact origin. The vault origin must be a host name (browsers refuse IP RP IDs).
 */
import { createHash } from 'node:crypto'
import { denied, VaultError, webauthnRpId } from './vault-domain.js'
import type { VaultIdentity } from './vault-domain.js'
import type { VaultEntropy, VaultTransaction, WebauthnVerifier } from './vault-ports.js'
import type { VaultService } from './vault.service.js'

const MAX_CREDENTIALS = 10
const REGISTRATION_MS = 120_000
interface Registration { challenge: string; name: string; expiresAt: number }
export interface WebauthnCredentialView { id: string; name: string; createdAt: number; lastUsedAt: number | null }

export class VaultWebauthnService {
  constructor(private readonly vault: VaultService, private readonly entropy: VaultEntropy, private readonly verifier?: WebauthnVerifier) {}

  private context(tx: VaultTransaction): { rpID: string; verifier: WebauthnVerifier; records: NonNullable<VaultTransaction['webauthn']> } {
    const rpID = webauthnRpId(tx.authority.policy.origin)
    if (!rpID || !this.verifier || !tx.webauthn) throw new VaultError('VAULT_WEBAUTHN_UNSUPPORTED', 409)
    return { rpID, verifier: this.verifier, records: tx.webauthn }
  }
  async credentials(i: VaultIdentity, origin: string): Promise<{ supported: boolean; credentials: WebauthnCredentialView[] }> {
    return this.vault.inspect(i, origin, 'webauthn-list', async tx => {
      const supported = !!this.verifier && !!tx.webauthn && webauthnRpId(tx.authority.policy.origin) !== null
      const list = supported && tx.webauthn ? await tx.webauthn.list() : []
      return { supported, credentials: list.map(c => ({ id: c.id, name: c.name, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt })) }
    })
  }
  async registrationOptions(i: VaultIdentity, clientId: string, origin: string, sessionId: string, name: string): Promise<{ options: object }> {
    return this.vault.confirmed(i, clientId, origin, sessionId, 'webauthn-register', async (tx, client) => {
      const { rpID, verifier, records } = this.context(tx)
      const existing = await records.list()
      if (existing.length >= MAX_CREDENTIALS) throw new VaultError('VAULT_WEBAUTHN_LIMIT', 409)
      const challenge = this.entropy.token(), expiresAt = tx.now() + REGISTRATION_MS
      await tx.put('webauthn', client.id, { challenge, name, expiresAt } satisfies Registration, expiresAt)
      // Stable opaque user handle per tenant/user; no e-mail or id in clear inside the authenticator handle.
      const userHandle = createHash('sha256').update(`nodeaccess-vault:${i.tenantId}:${i.userId}`).digest()
      const options = await verifier.registrationOptions({ rpID, rpName: 'NodeAccess', userHandle, userName: tx.authority.email, challenge,
        exclude: existing.map(c => ({ id: c.id, transports: c.transports })) })
      return { options }
    })
  }
  /** The registration challenge is burned and a failure audited in a committed transaction before refusing. */
  async register(i: VaultIdentity, clientId: string, origin: string, sessionId: string, response: { id: string }): Promise<{ id: string }> {
    const outcome = await this.vault.confirmed(i, clientId, origin, sessionId, 'webauthn-register', async (tx, client) => {
      const { rpID, verifier, records } = this.context(tx)
      const pending = await tx.get<Registration>('webauthn', client.id)
      await tx.remove('webauthn', client.id)
      // The limit is checked again here: options may have been requested on several clients.
      const room = (await records.list()).length < MAX_CREDENTIALS
      const verified = room && pending && pending.expiresAt > tx.now()
        ? await verifier.verifyRegistration({ response, challenge: pending.challenge, origin: tx.authority.policy.origin, rpID })
        : null
      if (!verified || !pending || !await records.add({ ...verified, name: pending.name })) {
        await tx.audit({ type: 'WEBAUTHN_REGISTRATION_DENIED', clientId, policyVersion: tx.authority.policy.version })
        return null
      }
      await tx.audit({ type: 'WEBAUTHN_REGISTERED', clientId, device: this.entropy.digest(verified.id), policyVersion: tx.authority.policy.version })
      return { id: verified.id }
    })
    if (!outcome) denied()
    return outcome
  }
  async remove(i: VaultIdentity, clientId: string, origin: string, sessionId: string, id: string): Promise<void> {
    await this.vault.confirmed(i, clientId, origin, sessionId, 'webauthn-remove', async tx => {
      const { records } = this.context(tx)
      if (!await records.remove(id)) denied()
      await tx.audit({ type: 'WEBAUTHN_REMOVED', clientId, device: this.entropy.digest(id), policyVersion: tx.authority.policy.version })
    })
  }
}
