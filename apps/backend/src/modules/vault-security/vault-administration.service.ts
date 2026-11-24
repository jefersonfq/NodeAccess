import type { VaultService } from './vault.service.js'
import { CONFIRMATION_DEFAULT_SECONDS, denied, PROPOSAL_DEFAULT_SECONDS, unavailable, webauthnRpId, type VaultChange, type VaultIdentity } from './vault-domain.js'
import type { VaultAdministrationSummary, VaultAdministrationView, VaultAvailability, VaultEntropy, VaultSettingsView } from './vault-ports.js'
export class VaultAdministrationService {
  constructor(private readonly vault: VaultService, private readonly entropy: VaultEntropy) {}
  async propose(i: VaultIdentity, c: string, o: string, s: string, change: VaultChange): Promise<{ proposalId: string }> {
    return this.vault.administer(i,c,o,s, async tx => {
      const proposalId = this.entropy.token()
      await tx.propose(proposalId, change, tx.authority.policy.proposalSeconds ?? PROPOSAL_DEFAULT_SECONDS)
      await tx.audit({ type: 'POLICY_CHANGE_PROPOSED', policyVersion: tx.authority.policy.version, operationId: proposalId, change })
      return { proposalId }
    })
  }
  async approve(i: VaultIdentity, c: string, o: string, s: string, proposalId: string): Promise<{ state: 'APPLIED' }> {
    return this.vault.administer(i,c,o,s, async tx => {
      const approved = await tx.approve(proposalId)
      await tx.audit({ ...approved, type: 'POLICY_CHANGED', policyVersion: tx.authority.policy.version + 1, operationId: proposalId })
      return { state: 'APPLIED' }
    })
  }
  /** NA-0183 portal screen: approve a listed proposal by its stored hash; the audit keeps the same hash as the proposal event. */
  async approveReference(i: VaultIdentity, c: string, o: string, s: string, reference: string): Promise<{ state: 'APPLIED' }> {
    return this.vault.administer(i,c,o,s, async tx => {
      const approved = await tx.approve(reference, true)
      await tx.audit({ ...approved, type: 'POLICY_CHANGED', policyVersion: tx.authority.policy.version + 1, operationRef: reference })
      return { state: 'APPLIED' }
    })
  }
  /** Whether the signed-in user manages this tenant's vault; no vault session needed (decides whether the portal shows the screen).
   * NA-0188: managers also get how many proposals await their approval and who the managers are. */
  async status(i: VaultIdentity, o: string): Promise<VaultAdministrationSummary> {
    return this.vault.inspect(i, o, 'administration-status', async tx => (await tx.administration?.summary()) ?? { manager: false, pending: 0, managers: [] })
  }
  /** Users, grants and live proposals; same confirmed session as any administrative change. */
  async overview(i: VaultIdentity, c: string, o: string, s: string): Promise<VaultAdministrationView> {
    return this.vault.confirmed(i,c,o,s, 'administration-overview', async tx => {
      if (!tx.administration) unavailable()
      const overview = await tx.administration.overview()
      const p = tx.authority.policy
      return { ...overview, policy: { confirmationSeconds: p.confirmationSeconds ?? CONFIRMATION_DEFAULT_SECONDS,
        proposalSeconds: p.proposalSeconds ?? PROPOSAL_DEFAULT_SECONDS, reveal: p.reveal === true, copy: p.copy === true, tenantQuota: p.tenantQuota } }
    })
  }
  /** NA-0199: current tenant settings for tenant administrators and vault managers (no unlock; read only). */
  async settings(i: VaultIdentity, o: string): Promise<VaultSettingsView> {
    return this.vault.inspect(i, o, 'settings', async tx => {
      const manager = (await tx.administration?.isManager()) ?? false
      if (!manager && tx.authority.role !== 'ADMIN') denied()
      const p = tx.authority.policy
      return { manager, reveal: p.reveal === true, copy: p.copy === true, tenantQuota: p.tenantQuota,
        confirmationSeconds: p.confirmationSeconds ?? CONFIRMATION_DEFAULT_SECONDS, proposalSeconds: p.proposalSeconds ?? PROPOSAL_DEFAULT_SECONDS,
        origin: p.origin, webauthn: webauthnRpId(p.origin) !== null }
    })
  }
  /** NA-0196: guidance for the signed-in user (no unlock): tenant policy, own grants and released items visible to them. */
  async availability(i: VaultIdentity, o: string): Promise<VaultAvailability> {
    return this.vault.inspect(i, o, 'availability', async tx => {
      const own = (await tx.availability?.()) ?? { grants: { reveal: false, copy: false }, items: [] }
      return { policy: { reveal: tx.authority.policy.reveal === true, copy: tx.authority.policy.copy === true }, ...own }
    })
  }
}
