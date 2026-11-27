import { denied } from './vault-domain.js'
import type { VaultTransaction } from './vault-ports.js'
import type { VaultDiagnosticsResult } from './vault-diagnostics.repository.js'
/** Bind diagnostics in SqlVaultTransaction; invoke only inside confirmed/administer. */
export type VaultDiagnosticsTransaction = VaultTransaction & {
  diagnostics?: { diagnose(userId: number, secretId: number): Promise<VaultDiagnosticsResult> }
}
export async function diag(tx: VaultDiagnosticsTransaction, userId: number, secretId: number): Promise<VaultDiagnosticsResult> {
  // administer alone does NOT require a manager.
  if (!tx.administration || !await tx.administration.isManager() || !tx.diagnostics) denied()
  return tx.diagnostics.diagnose(userId, secretId)
}
