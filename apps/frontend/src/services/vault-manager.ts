/**
 * NA-0186 — shared "is the signed-in user a vault manager?" check, used by the vault section and the Users tab.
 * Same rules as every vault request: HTTPS page, own tenant (no acting/managed tenant) and both portal tokens.
 */
import { VaultAdministrationStatusSchema, VaultAvailabilitySchema, VaultSettingsSchema, type VaultAdministrationStatus, type VaultAvailability, type VaultSettings } from '@nodeaccess/shared'
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
/** NA-0196: tenant policy, own grants and released items visible to the user. `null` when unknown (same cases as the
 * status): the page then keeps today's behaviour and the server explains on request. Guidance only. */
export async function vaultAvailability(transport: VaultTransport, auth: AuthStore): Promise<VaultAvailability | null> {
  const who = vaultPortalIdentity(auth)
  if (!who) return null
  try { return VaultAvailabilitySchema.parse(await transport.post('availability', {}, who)) } catch { return null }
}
export type DeliveryAction = 'reveal' | 'copy'
/** Why reveal/copy are not offered: tenant policy off, no own permission, or item not released. */
export type DeliveryReason = 'policy' | 'grant' | 'item'
/** Reason that holds for every item (shown once, above the list), or null. */
export function deliveryBlock(a: VaultAvailability | null): Exclude<DeliveryReason, 'item'> | null {
  if (!a) return null
  if (!a.policy.reveal && !a.policy.copy) return 'policy'
  return (['reveal', 'copy'] as const).some(action => a.policy[action] && a.grants[action]) ? null : 'grant'
}
/** Actions offered for one Secret and, when none, the reason. Unknown availability offers both (the server decides). */
export function deliveryFor(a: VaultAvailability | null, secretId: number): { actions: DeliveryAction[]; reason: DeliveryReason | null } {
  if (!a) return { actions: ['reveal', 'copy'], reason: null }
  const block = deliveryBlock(a)
  if (block) return { actions: [], reason: block }
  // The server lists at most 1000 released items: a full list is not proof that an item is missing.
  if (!a.items.includes(secretId) && a.items.length < 1000) return { actions: [], reason: 'item' }
  return { actions: (['reveal', 'copy'] as const).filter(action => a.policy[action] && a.grants[action]), reason: null }
}
/** NA-0199: tenant settings for /admin/settings. `null` = unknown (insecure page, no tokens, server error);
 * 'denied' = refused (403, which also covers a tenant without a configured vault); 'unconfigured' = vault routes disabled (404). */
export async function vaultSettings(transport: VaultTransport, auth: AuthStore): Promise<VaultSettings | 'denied' | 'unconfigured' | null> {
  const who = vaultPortalIdentity(auth)
  if (!who) return null
  try { return VaultSettingsSchema.parse(await transport.post('administration/settings', {}, who)) } catch (error) {
    const reason = (error as { reason?: unknown } | null)?.reason
    if (reason === 'denied') return 'denied'
    if (reason === 'unsupported') return 'unconfigured'
    return null
  }
}
