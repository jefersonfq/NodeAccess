/**
 * NA-0186 — shared "is the signed-in user a vault manager?" check, used by the vault section and the Users tab.
 * Same rules as every vault request: HTTPS page, own tenant (no acting/managed tenant) and both portal tokens.
 */
import { VaultAdministrationStatusSchema, type VaultAdministrationStatus } from '@nodeaccess/shared'
import type { useAuthStore } from '@/stores/auth'
import type { VaultPortalIdentity, VaultTransport } from '@/services/vault-http'

type AuthStore = ReturnType<typeof useAuthStore>
export function vaultPortalIdentity(auth: AuthStore): VaultPortalIdentity | null {
  const u = auth.user
  const secure = globalThis.isSecureContext === true && typeof window !== 'undefined' && window.location?.protocol === 'https:'
  if (!secure || !u || u.actingTenantId !== undefined || auth.isManagingTenant || !auth.accessToken || !auth.refreshToken) return null
  return { userId: u.id, tenantId: u.tenantId, accessToken: auth.accessToken, refreshToken: auth.refreshToken, origin: window.location.origin }
}
/** NA-0188: manager flag, proposals awaiting this manager and manager ids. `null` when unknown (insecure page, no tokens,
 * another tenant, no vault, server error or rate limit): callers then grant nothing and may keep what they last knew.
 * The server still decides every change. */
export async function vaultAdministrationStatus(transport: VaultTransport, auth: AuthStore): Promise<VaultAdministrationStatus | null> {
  const who = vaultPortalIdentity(auth)
  if (!who) return null
  try { return VaultAdministrationStatusSchema.parse(await transport.post('administration/status', {}, who)) } catch { return null }
}
/** False on any doubt. */
export async function isVaultManager(transport: VaultTransport, auth: AuthStore): Promise<boolean> {
  return (await vaultAdministrationStatus(transport, auth))?.manager === true
}
/** NA-0188: whether some manager other than the proposer and the beneficiary could approve (guidance only). */
export function hasApprover(managers: readonly number[], proposer: number | undefined, target?: number): boolean {
  return managers.some(id => id !== proposer && id !== target)
}
/** Human duration for proposal windows and countdowns: "45 s", "5 min", "2 h", "1 h 30 min". */
export function formatDuration(seconds: number, units: { s: string; min: string; h: string }): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} ${units.s}`
  const minutes = Math.ceil(total / 60)
  if (minutes < 60) return `${minutes} ${units.min}`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return m ? `${h} ${units.h} ${m} ${units.min}` : `${h} ${units.h}`
}
