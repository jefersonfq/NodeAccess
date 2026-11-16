import type { VaultService } from './vault.service.js'
import type { VaultChange, VaultIdentity } from './vault-domain.js'
import type { VaultEntropy } from './vault-ports.js'
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
}
