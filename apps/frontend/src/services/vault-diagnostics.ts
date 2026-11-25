import { VaultDiagnosticsRequestSchema, VaultDiagnosticsSchema, type VaultDiagnostics } from '../../../../packages/shared/src/schemas/vault-diagnostics.schema'
import { VaultClientError, type VaultPortalIdentity, type VaultTransport } from './vault-http'
/** Parent's existing confirmed client/session; no unlock, retry or persistent storage. */
export async function vaultDiagnostics(transport: VaultTransport, identity: VaultPortalIdentity, clientId: string,
  sessionId: string, userId: number, secretId: number, signal?: AbortSignal): Promise<VaultDiagnostics> {
  if (!clientId || !sessionId) throw new VaultClientError('locked')
  const body = VaultDiagnosticsRequestSchema.parse({ sessionId, userId, secretId })
  const reply = VaultDiagnosticsSchema.safeParse(await transport.post<unknown>('administration/diagnostics', body, identity, clientId, signal))
  if (!reply.success || reply.data.userId !== userId || reply.data.secretId !== secretId) throw new VaultClientError('unavailable')
  return reply.data
}
