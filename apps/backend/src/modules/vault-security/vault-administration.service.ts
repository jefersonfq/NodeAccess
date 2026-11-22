import type { VaultService } from './vault.service.js'
import { unavailable, type VaultChange, type VaultIdentity } from './vault-domain.js'
import type { VaultAdministrationOverview, VaultEntropy } from './vault-ports.js'
export class VaultAdministrationService {
  constructor(private readonly vault: VaultService, private readonly entropy: VaultEntropy) {}
  async propose(i: VaultIdentity, c: string, o: string, s: string, change: VaultChange): Promise<{ proposalId: string }> {
    return this.vault.administer(i,c,o,s, async tx => {
      const proposalId = this.entropy.token()
      await tx.propose(proposalId, change)
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
  /** Whether the signed-in user manages this tenant's vault; no vault session needed (decides whether the portal shows the screen). */
  async status(i: VaultIdentity, o: string): Promise<{ manager: boolean }> {
    return this.vault.inspect(i, o, 'administration-status', async tx => ({ manager: (await tx.administration?.isManager()) === true }))
  }
  /** Users, grants and live proposals; same confirmed session as any administrative change. */
  async overview(i: VaultIdentity, c: string, o: string, s: string): Promise<VaultAdministrationOverview> {
    return this.vault.confirmed(i,c,o,s, 'administration-overview', tx => {
      if (!tx.administration) unavailable()
      return tx.administration.overview()
    })
  }
}
