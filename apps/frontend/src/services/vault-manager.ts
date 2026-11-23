/**
 * NA-0186 — shared "is the signed-in user a vault manager?" check, used by the vault section and the Users tab.
 * Same rules as every vault request: HTTPS page, own tenant (no acting/managed tenant) and both portal tokens.
 */
import { VaultAdministrationStatusSchema } from '@nodeaccess/shared'
import type { useAuthStore } from '@/stores/auth'
import type { VaultPortalIdentity, VaultTransport } from '@/services/vault-http'

type AuthStore = ReturnType<typeof useAuthStore>
export function vaultPortalIdentity(auth: AuthStore): VaultPortalIdentity | null {
  const u = auth.user
  const secure = globalThis.isSecureContext === true && typeof window !== 'undefined' && window.location?.protocol === 'https:'
  if (!secure || !u || u.actingTenantId !== undefined || auth.isManagingTenant || !auth.accessToken || !auth.refreshToken) return null
  return { userId: u.id, tenantId: u.tenantId, accessToken: auth.accessToken, refreshToken: auth.refreshToken, origin: window.location.origin }
}
/** False on any doubt (insecure page, no tokens, server error); the server still decides every change. */
export async function isVaultManager(transport: VaultTransport, auth: AuthStore): Promise<boolean> {
  const who = vaultPortalIdentity(auth)
  if (!who) return false
  try { return VaultAdministrationStatusSchema.parse(await transport.post('administration/status', {}, who)).manager } catch { return false }
}
