import { randomUUID } from 'node:crypto'
import type { PrismaClient, Prisma } from '@prisma/client'
import { assertTrialCapability, trialDenied } from './trial-policy.js'

let database: PrismaClient | undefined
export function configureTrialAiQuota(db: PrismaClient): void { database = db }
/** Durable lifetime request budget; expiring leases survive crashed workers without permanent exhaustion. */
export async function reserveTrialAiRequest(tenantId: number): Promise<() => Promise<void>> {
  if (!await assertTrialCapability(tenantId, 'localAi')) return async () => {}
  if (!database) throw trialDenied('TRIAL_CAPACITY_UNAVAILABLE')
  const db = database, id = randomUUID()
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM trial_registrations WHERE tenant_id = ${tenantId} FOR UPDATE`
    const trial = await tx.trialRegistration.findUnique({ where: { tenantId } })
    if (!trial || trial.status !== 'ACTIVE' || !trial.expiresAt || trial.expiresAt.getTime() <= Date.now()) throw trialDenied()
    const profile = trial.profileJson as Record<string, Prisma.JsonValue>
    const maximum = Number(profile.maxAiRequests ?? 100), concurrent = Number(profile.maxAiConcurrentRequests ?? 1), used = Number(profile.aiRequestsUsed ?? 0)
    if (![maximum, concurrent, used].every(Number.isSafeInteger) || maximum < 1 || concurrent < 1 || used < 0) throw trialDenied('TRIAL_CAPACITY_UNAVAILABLE')
    const raw = profile.aiRequestLeases
    const leases = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const active = Object.fromEntries(Object.entries(leases).filter(([, until]) => typeof until === 'number' && until > Date.now()))
    if (used >= maximum || Object.keys(active).length >= concurrent) throw trialDenied('TRIAL_AI_LIMIT')
    await tx.trialRegistration.update({ where: { tenantId }, data: { profileJson: { ...profile, aiRequestsUsed: used + 1, aiRequestLeases: { ...active, [id]: Date.now() + 125_000 } } } })
  })
  let released = false
  return async (): Promise<void> => {
    if (released) return
    released = true
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE tenant_id = ${tenantId} FOR UPDATE`
      const trial = await tx.trialRegistration.findUnique({ where: { tenantId } })
      if (!trial) return
      const profile = trial.profileJson as Record<string, Prisma.JsonValue>
      const leases = profile.aiRequestLeases
      if (!leases || typeof leases !== 'object' || Array.isArray(leases)) return
      const next = { ...leases }; delete next[id]
      await tx.trialRegistration.update({ where: { tenantId }, data: { profileJson: { ...profile, aiRequestLeases: next } } })
    })
  }
}
