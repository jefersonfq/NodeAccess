import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { HostRepository } from '../hosts/host.repository.js'
import { HostBulkActionRepository } from '../hosts/host-bulk-action.repository.js'
import { TagRepository } from '../tags/tag.repository.js'
import { describe, expect, it } from 'vitest'
import { assertTrialHostMutation } from './trial-host-quota.js'
import { configureTrialPolicy, configureTrialProtectedAddresses } from './trial-policy.js'

const url = process.env.TRIAL_RETENTION_DATABASE_URL
describe.skipIf(!url)('host quota with one actual SQL connection', () => {
  it('keeps normal and trial checks on the transaction connection, retaining destination/demo guards', async () => {
    const parsed = new URL(url!)
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/na0074_retention') throw Error('Dedicated local schema required')
    parsed.searchParams.set('connection_limit', '1'); parsed.searchParams.set('pool_timeout', '1')
    const db = new PrismaClient({ datasourceUrl: parsed.toString() })
    const tenants: number[] = []
    let peer: PrismaClient | undefined
    let externalReads = 0
    configureTrialPolicy(tenantId => { externalReads++; return db.trialRegistration.findUnique({ where: { tenantId } }) })
    configureTrialProtectedAddresses(['9.9.9.9'])
    try {
      const suffix = randomUUID()
      const normal = await db.tenant.create({ data: { name: 'Synthetic normal', slug: `pool-normal-${suffix}` } }); tenants.push(normal.id)
      const tenant = await db.tenant.create({ data: { name: 'Synthetic trial', slug: `pool-trial-${suffix}` } }); tenants.push(tenant.id)
      const owner = await db.user.create({ data: { tenantId: tenant.id, name: 'Synthetic owner', email: `${suffix}@example.test` } })
      const demo = await db.host.create({ data: { tenantId: tenant.id, ownerId: owner.id, name: 'Synthetic demo', ip: '10.64.0.4', sshUser: 'demo', authType: 'PASSWORD', scope: 'PERSONAL' } })
      await db.trialRegistration.create({ data: { id: randomUUID(), tenantId: tenant.id, name: 'Synthetic', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), privacyVersion: 'synthetic', profileJson: { experience: 'full', allowCustomHosts: true, networkCidr: '10.64.0.0/24', hostAddresses: [demo.ip], machineCount: 1, requestedMachines: 1, maxHosts: 2, maxCustomHosts: 1 } } })
      await db.$transaction(tx => assertTrialHostMutation(tx, normal.id, 'create', '192.168.1.9'), { timeout: 3000 })
      await db.$transaction(async tx => {
        await assertTrialHostMutation(tx, tenant.id, 'create', '8.8.8.8')
        await tx.host.create({ data: { tenantId: tenant.id, ownerId: owner.id, name: 'Synthetic custom', ip: '8.8.8.8', sshUser: 'demo', authType: 'PASSWORD', scope: 'PERSONAL' } })
      }, { timeout: 3000 })
      await expect(db.$transaction(tx => assertTrialHostMutation(tx, tenant.id, 'create', '8.8.4.4'), { timeout: 3000 })).rejects.toMatchObject({ code: 'TRIAL_HOST_LIMIT' })
      await expect(db.$transaction(tx => assertTrialHostMutation(tx, tenant.id, 'delete', undefined, demo.id), { timeout: 3000 })).rejects.toMatchObject({ code: 'TRIAL_MANAGED_HOST' })
      await expect(db.$transaction(tx => assertTrialHostMutation(tx, tenant.id, 'create', '9.9.9.9'), { timeout: 3000 })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
      // A separate eight-connection pool proves row-lock counting, not just serial single-connection behavior.
      await db.host.deleteMany({ where: { tenantId: tenant.id, id: { not: demo.id } } })
      const concurrentUrl = new URL(parsed); concurrentUrl.searchParams.set('connection_limit', '8')
      peer = new PrismaClient({ datasourceUrl: concurrentUrl.toString() })
      let arrivals = 0
      let release: () => void = () => {}
      const together = new Promise<void>(resolve => { release = resolve })
      const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => peer!.$transaction(async tx => {
        arrivals++; if (arrivals === 8) release()
        await together
        await assertTrialHostMutation(tx, tenant.id, 'create', '8.8.8.8')
        return tx.host.create({ data: { tenantId: tenant.id, ownerId: owner.id, name: `Synthetic concurrent ${i}`, ip: '8.8.8.8', sshUser: 'demo', authType: 'PASSWORD', scope: 'PERSONAL' } })
      }, { timeout: 5000, maxWait: 5000 })))
      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      for (const result of attempts) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'TRIAL_HOST_LIMIT' })
      const repository = new HostRepository(db, new TagRepository(db))
      const bulk = new HostBulkActionRepository(db)
      await expect(repository.update(demo.id, tenant.id, { name: 'Forbidden demo edit' })).rejects.toMatchObject({ code: 'TRIAL_MANAGED_HOST' })
      await expect(bulk.applyAction([demo.id], tenant.id, { type: 'set_bastion', bastionId: null }, owner.id)).rejects.toMatchObject({ code: 'TRIAL_MANAGED_HOST' })
      await expect(bulk.restoreSnapshots(tenant.id, [{ hostId: demo.id, bastionId: null }], ['bastionId'], owner.id)).rejects.toMatchObject({ code: 'TRIAL_MANAGED_HOST' })
      expect(externalReads).toBe(0)
      expect(await db.host.count({ where: { tenantId: tenant.id } })).toBe(2)
    } finally {
      configureTrialPolicy(() => Promise.resolve(null)); configureTrialProtectedAddresses([])
      await db.trialRegistration.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.host.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.user.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await peer?.$disconnect(); await db.$disconnect()
    }
  }, 15_000)
})
