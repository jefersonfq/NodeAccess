import type { Prisma, TrialRegistration } from '@prisma/client'
import { validateTrialRoutedDestination, trialDenied } from './trial-policy.js'

/** Lock before any consistent read: MySQL REPEATABLE READ must see the latest quotas. */
export async function lockTrialHostTenant(tx: Prisma.TransactionClient, tenantId: number): Promise<TrialRegistration | null> {
  await tx.$queryRaw`SELECT id FROM trial_registrations WHERE tenant_id = ${tenantId} FOR UPDATE`
  return tx.trialRegistration.findUnique({ where: { tenantId } })
}

/** Called inside the host mutation transaction, sharing the provider's reservation lock. */
export async function assertTrialHostMutation(tx: Prisma.TransactionClient, tenantId: number, kind: 'create' | 'update' | 'delete', ip?: string, hostId?: number, connectionMode = 'DIRECT'): Promise<void> {
  const trial = await lockTrialHostTenant(tx, tenantId)
  if (!trial) return
  if (trial.status !== 'ACTIVE' || !trial.expiresAt || trial.expiresAt.getTime() <= Date.now()) throw trialDenied()
  const profile = trial.profileJson as { experience?: string; maxHosts?: number; maxCustomHosts?: number; machineCount?: number; requestedMachines?: number; hostAddresses?: string[]; allowCustomHosts?: boolean }
  if (profile.experience !== 'full') throw trialDenied('TRIAL_FEATURE_DISABLED')
  const addresses = profile.hostAddresses
  if (!Array.isArray(addresses) || !addresses.length) throw trialDenied('TRIAL_CAPACITY_UNAVAILABLE')
  if (hostId !== undefined) {
    const current = await tx.host.findFirst({ where: { id: hostId, tenantId, deletedAt: null } })
    if (!current || addresses.includes(current.ip)) throw trialDenied('TRIAL_MANAGED_HOST')
  }
  if (kind !== 'delete') {
    if (!ip || profile.allowCustomHosts !== true || addresses.includes(ip)) throw trialDenied('TRIAL_DESTINATION_DENIED')
    validateTrialRoutedDestination(trial, ip, connectionMode)
  }
  if (kind === 'create') {
    const max = profile.maxHosts, customMax = profile.maxCustomHosts, reserved = profile.requestedMachines ?? profile.machineCount
    if (!Number.isSafeInteger(max) || !max || !Number.isSafeInteger(customMax) || !customMax || !Number.isSafeInteger(reserved) || !reserved) throw trialDenied('TRIAL_CAPACITY_UNAVAILABLE')
    const custom = await tx.host.count({ where: { tenantId, deletedAt: null, ip: { notIn: addresses } } })
    const total = await tx.host.count({ where: { tenantId, deletedAt: null } })
    if (custom >= customMax || total >= max || custom + reserved >= max) throw trialDenied('TRIAL_HOST_LIMIT')
  }
}
