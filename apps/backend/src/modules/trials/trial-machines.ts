import { Prisma, type PrismaClient, type TrialRegistration } from '@prisma/client'
import { z } from 'zod'
import { AppError } from '../../shared/errors.js'
import { encrypt, decrypt, type EncryptedPayload } from '../../shared/crypto.js'
import { trialProfileFromSnapshot, validateLab, labSchema, type TrialProfile } from './trial-contract.js'
import type { TrialProvisioner } from './trial-provisioner.js'

export interface TrialMachineSnapshot extends TrialProfile {
  hostAddresses: string[]
  requestedMachines: number
  machineRequestError?: string | null
}
function snapshot(row: TrialRegistration): TrialMachineSnapshot {
  const profile = trialProfileFromSnapshot(row.profileJson)
  const stored = row.profileJson as Record<string, unknown>
  return { ...profile, hostAddresses: Array.isArray(stored.hostAddresses) ? stored.hostAddresses as string[] : [],
    requestedMachines: typeof stored.requestedMachines === 'number' ? stored.requestedMachines : profile.machineCount,
    machineRequestError: typeof stored.machineRequestError === 'string' ? stored.machineRequestError : null }
}
function active(row: TrialRegistration | null): asserts row is TrialRegistration {
  if (!row || row.status !== 'ACTIVE' || !row.expiresAt || row.expiresAt.getTime() <= Date.now()) {
    throw new AppError('Degustação encerrada ou indisponível', 403, 'TRIAL_EXPIRED')
  }
}
/** Additional machines are a durable desired count; provider retries never reset live hosts. */
export class TrialMachines {
  constructor(private readonly db: PrismaClient, private readonly provisioner?: TrialProvisioner) {}

  async resources(tenantId: number, userId: number): Promise<{ machineCount: number; requestedMachines: number; maxMachines: number; customHostCount: number; maxCustomHosts: number; allowCustomHosts: boolean; maxHosts: number; provisioning: boolean; error: string | null; customHosts: Array<{ id: number; name: string; ip: string; port: number; sshUser: string; authType: string }> }> {
    const row = await this.db.trialRegistration.findUnique({ where: { tenantId } }); active(row)
    const profile = snapshot(row)
    const customHostCount = await this.db.host.count({ where: { tenantId, deletedAt: null, ip: { notIn: profile.hostAddresses } } })
    const customHosts = await this.db.host.findMany({ where: { tenantId, ownerId: userId, scope: 'PERSONAL', deletedAt: null, ip: { notIn: profile.hostAddresses } }, select: { id: true, name: true, ip: true, port: true, sshUser: true, authType: true } })
    return { customHosts, machineCount: profile.hostAddresses.length, requestedMachines: profile.requestedMachines,
      maxMachines: profile.maxMachines ?? profile.machineCount, customHostCount,
      maxCustomHosts: profile.maxCustomHosts ?? 0, allowCustomHosts: profile.allowCustomHosts ?? false,
      maxHosts: profile.maxHosts, provisioning: profile.requestedMachines > profile.hostAddresses.length,
      error: profile.machineRequestError ?? null }
  }

  async request(tenantId: number, input: unknown): Promise<{ requestedMachines: number }> {
    const { count } = z.object({ count: z.number().int().min(1).max(10) }).strict().parse(input)
    if (!this.provisioner) throw new AppError('Laboratório temporariamente indisponível', 503, 'TRIAL_UNAVAILABLE')
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE tenant_id = ${tenantId} FOR UPDATE`
      const row = await tx.trialRegistration.findUnique({ where: { tenantId } }); active(row)
      const profile = snapshot(row)
      const customCount = await tx.host.count({ where: { tenantId, deletedAt: null, ip: { notIn: profile.hostAddresses } } })
      if (count < profile.requestedMachines || count > (profile.maxMachines ?? profile.machineCount) || count + customCount > profile.maxHosts) {
        throw new AppError('Quantidade fora dos limites disponíveis no teste', 409, 'TRIAL_MACHINE_LIMIT')
      }
      await tx.trialRegistration.update({ where: { id: row.id }, data: { profileJson: { ...profile, requestedMachines: count, machineRequestError: null } } })
      return { requestedMachines: count }
    })
  }

  async tick(): Promise<void> {
    if (!this.provisioner) return
    const rows = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM trial_registrations WHERE status = 'ACTIVE' AND expires_at > CURRENT_TIMESTAMP(3)
      ORDER BY updated_at ASC LIMIT 20`
    for (const { id } of rows) {
      try { await this.expand(id) }
      catch {
        // Do not close a working lab when an additional machine fails. Keep the reservation for retry.
        const row = await this.db.trialRegistration.findUnique({ where: { id } })
        if (row?.status === 'ACTIVE') await this.db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${id} FOR UPDATE`
          const current = await tx.trialRegistration.findUnique({ where: { id } })
          if (current?.status === 'ACTIVE') await tx.trialRegistration.update({ where: { id }, data: {
            profileJson: { ...(current.profileJson as Prisma.JsonObject), machineRequestError: 'TRIAL_MACHINE_RETRY' }, updatedAt: new Date(),
          } })
        })
      }
    }
  }

  private async expand(id: string): Promise<void> {
    const row = await this.db.trialRegistration.findUnique({ where: { id } }); active(row)
    const profile = snapshot(row)
    const desired = { ...trialProfileFromSnapshot(row.profileJson), machineCount: profile.requestedMachines }
    const lab = labSchema.parse(await this.provisioner!.ensure(id, desired))
    validateLab(lab, id, desired)
    const current = await this.db.trialRegistration.findUnique({ where: { id } })
    if (!current || current.status !== 'ACTIVE' || !current.expiresAt || current.expiresAt.getTime() <= Date.now()) {
      await this.provisioner!.remove(id)
      return
    }
    if (lab.state !== 'ready') {
      await this.db.trialRegistration.updateMany({ where: { id, status: 'ACTIVE' }, data: { updatedAt: new Date() } })
      return
    }
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_profiles WHERE id = 1 FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${id} FOR UPDATE`
      const stored = await tx.trialRegistration.findUnique({ where: { id } }); active(stored)
      const state = snapshot(stored)
      if (!stored.tenantId || state.requestedMachines !== profile.requestedMachines) return
      const tenantId = stored.tenantId
      const inventoryRoot = await tx.inventoryNode.findFirst({ where: { tenantId, rootTenantId: tenantId, type: 'ROOT', deletedAt: null }, select: { id: true } })
      if (!inventoryRoot) throw new Error('TRIAL_INVENTORY_UNAVAILABLE')
      const existing = await tx.host.findMany({ where: { tenantId, ip: { in: state.hostAddresses }, deletedAt: null } })
      if (existing.length !== state.hostAddresses.length || existing.some(host => !lab.hosts.some(next => next.ip === host.ip && next.port === host.port && next.sshUser === host.sshUser && host.passwordEncrypted && decrypt(JSON.parse(host.passwordEncrypted) as EncryptedPayload) === next.password && `${next.fingerprint.replace(/=+$/, '')}=` === host.trustedHostKeyFingerprint))) {
        throw new Error('LAB_EXISTING_HOST_CHANGED')
      }
      const added = lab.hosts.filter(host => !state.hostAddresses.includes(host.ip))
      if (!added.length) {
        await tx.trialRegistration.update({ where: { id }, data: { profileJson: { ...state, machineRequestError: null }, updatedAt: new Date() } })
        return
      }
      if (await tx.host.findFirst({ where: { ip: { in: added.map(host => host.ip) }, deletedAt: null }, select: { id: true } })) throw new Error('LAB_ADDRESS_ALREADY_ASSIGNED')
      const owner = await tx.user.findFirst({ where: { tenantId, email: stored.email! }, select: { id: true } })
      if (!owner) throw new Error('TRIAL_OWNER_UNAVAILABLE')
      const hostCount = await tx.host.count({ where: { tenantId, deletedAt: null } })
      if (hostCount + added.length > state.maxHosts) throw new Error('TRIAL_HOST_LIMIT')
      for (const host of added) {
        const created = await tx.host.create({ data: { name: host.name, ip: host.ip, port: host.port, sshUser: host.sshUser,
          authType: 'PASSWORD', passwordEncrypted: JSON.stringify(encrypt(host.password)), scope: 'GLOBAL', ownerId: owner.id,
          tenantId, trustedHostKeyFingerprint: `${host.fingerprint.replace(/=+$/, '')}=`, operatingSystem: 'LINUX' } })
        await tx.$executeRaw(Prisma.sql`INSERT INTO inventory_nodes (tenant_id, parent_id, type, host_id, name, path, depth, updated_at)
          SELECT ${tenantId}, id, 'HOST', ${created.id}, ${host.name}, '', 1, CURRENT_TIMESTAMP(3)
          FROM inventory_nodes WHERE root_tenant_id = ${tenantId}`)
        await tx.$executeRaw(Prisma.sql`UPDATE inventory_nodes node INNER JOIN inventory_nodes parent ON parent.id = node.parent_id
          SET node.path = CONCAT(parent.path, node.id, '/') WHERE node.host_id = ${created.id}`)
        await tx.$executeRaw(Prisma.sql`INSERT INTO resource_acl_entries
          (tenant_id, inventory_node_id, principal_type, principal_id, can_view, can_connect, can_edit, can_admin, inherit_to_children, created_by_id, updated_at)
          SELECT ${tenantId}, id, 'ROLE', 1, true, true, false, false, false, ${owner.id}, CURRENT_TIMESTAMP(3)
          FROM inventory_nodes WHERE host_id = ${created.id}`)
      }
      await tx.trialRegistration.update({ where: { id }, data: { profileJson: { ...state, hostAddresses: lab.hosts.map(host => host.ip), machineRequestError: null } } })
    })
  }
}
