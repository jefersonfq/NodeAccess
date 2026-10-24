import { isIPv4 } from 'node:net'
import type { Host, Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { validateTrialPrivateKey } from './trial-pem-validation.js'
import { validateTrialCustomAddress } from './trial-address-policy.js'
export { validateTrialCustomAddress } from './trial-address-policy.js'
import { encrypt } from '../../shared/crypto.js'
import { AppError, NotFoundError, ValidationError } from '../../shared/errors.js'

const inputSchema = z.object({
  name: z.string().trim().min(1).max(120), ip: z.string().max(15),
  port: z.number().int().min(1).max(65535).default(22),
  sshUser: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.@-]+$/),
  authType: z.enum(['password', 'pem']),
  password: z.string().min(1).max(4096).optional(),
  privateKey: z.string().min(1).max(65536).optional(),
  passphrase: z.string().max(4096).optional(),
}).strict()
export type TrialCustomHostInput = z.input<typeof inputSchema>
type Profile = { allowCustomHosts: true; maxCustomHosts: number; maxHosts: number; requestedMachines: number; hostAddresses: string[] }
const forbidden = (code: string, message: string): AppError => new AppError(message, 403, code)
async function parseInput(input: unknown): Promise<z.output<typeof inputSchema>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new ValidationError('Confira nome, IPv4 público, porta e credenciais do host.')
  const value = parsed.data
  if ((value.authType === 'password' && (value.privateKey !== undefined || value.passphrase !== undefined)) || (value.authType === 'pem' && value.password !== undefined)) throw new ValidationError('Informe somente as credenciais do método escolhido.')
  if (value.passphrase !== undefined && value.privateKey === undefined) throw new ValidationError('Informe a chave privada junto com sua senha.')
  if (value.privateKey) await validateTrialPrivateKey(value.privateKey, value.passphrase)
  return value
}
export class TrialCustomHosts {
  constructor(private readonly db: PrismaClient, private readonly options: { protectedAddresses?: readonly string[] } = {}) {}
  private requireProtectedAddresses(): void {
    if (!this.options.protectedAddresses?.length || this.options.protectedAddresses.some(ip => !isIPv4(ip))) throw new AppError('Cadastro de hosts próprios temporariamente indisponível.', 503, 'TRIAL_CUSTOM_HOSTS_UNAVAILABLE')
  }
  private async access(tx: Prisma.TransactionClient, tenantId: number, userId: number): Promise<Profile> {
    // Shared with trial SSH admission, cancellation and machine allocation.
    await tx.$queryRaw`SELECT id FROM trial_registrations WHERE tenant_id = ${tenantId} FOR UPDATE`
    const trial = await tx.trialRegistration.findUnique({ where: { tenantId } })
    if (!trial || trial.status !== 'ACTIVE' || !trial.expiresAt || trial.expiresAt.getTime() <= Date.now()) throw forbidden('TRIAL_EXPIRED', 'Degustação encerrada ou indisponível.')
    if (!await tx.user.findFirst({ where: { id: userId, tenantId, active: true, deletedAt: null }, select: { id: true } })) throw forbidden('TRIAL_USER_REVOKED', 'Acesso à degustação revogado.')
    const raw = trial.profileJson as Record<string, unknown> | null
    const maxCustomHosts = Number(raw?.maxCustomHosts), maxHosts = Number(raw?.maxHosts), requestedMachines = Number(raw?.requestedMachines ?? raw?.machineCount)
    if (raw?.allowCustomHosts !== true || !Array.isArray(raw.resources) || !raw.resources.includes('ssh')
      || !Number.isInteger(maxCustomHosts) || maxCustomHosts < 0 || maxCustomHosts > 100
      || !Number.isInteger(maxHosts) || maxHosts < 1 || !Number.isInteger(requestedMachines) || requestedMachines < 1
      || !Array.isArray(raw.hostAddresses) || !raw.hostAddresses.every(ip => typeof ip === 'string' && isIPv4(ip))) throw forbidden('TRIAL_CUSTOM_HOSTS_DISABLED', 'Cadastro de hosts próprios indisponível nesta degustação.')
    return { allowCustomHosts: true, maxCustomHosts, maxHosts, requestedMachines, hostAddresses: raw.hostAddresses as string[] }
  }
  private async ownHost(tx: Prisma.TransactionClient, profile: Profile, tenantId: number, userId: number, hostId: number): Promise<Host> {
    const host = await tx.host.findFirst({ where: { id: hostId, tenantId, ownerId: userId, scope: 'PERSONAL', deletedAt: null } })
    if (!host || profile.hostAddresses.includes(host.ip)) throw new NotFoundError('Host próprio')
    if (await tx.session.count({ where: { hostId, active: true } })) throw new AppError('Encerre as sessões SSH deste host antes de alterá-lo ou removê-lo.', 409, 'TRIAL_HOST_IN_USE')
    return host
  }
  private async createPem(tx: Prisma.TransactionClient, userId: number, input: z.output<typeof inputSchema>): Promise<number> {
    const key = encrypt(input.privateKey!)
    const phrase = input.passphrase ? encrypt(input.passphrase) : null
    return (await tx.pemKey.create({ data: { name: `Degustação: ${input.name}`, createdById: userId, encryptedKey: key.encrypted, iv: key.iv, encryptedPassphrase: phrase?.encrypted ?? null, passphraseIv: phrase?.iv ?? null } })).id
  }
  private async discardPem(tx: Prisma.TransactionClient, userId: number, keyId: number | null): Promise<void> {
    if (!keyId) return
    await tx.pemKey.deleteMany({ where: { id: keyId, createdById: userId, hosts: { none: {} }, bastionHosts: { none: {} } } })
  }
  /** Upgrade only this trial's legacy inherited demo grants before creating personal hosts. */
  private async isolateDemoAcl(tx: Prisma.TransactionClient, tenantId: number, userId: number, profile: Profile): Promise<number> {
    const root = await tx.inventoryNode.findFirst({ where: { tenantId, rootTenantId: tenantId, type: 'ROOT', deletedAt: null } })
    if (!root) throw new AppError('Inventário da degustação indisponível.', 409, 'TRIAL_INVENTORY_UNAVAILABLE')
    const demos = await tx.inventoryNode.findMany({ where: { tenantId, type: 'HOST', deletedAt: null, host: { ip: { in: profile.hostAddresses }, deletedAt: null, scope: 'GLOBAL' } }, select: { id: true } })
    for (const demo of demos) await tx.resourceAclEntry.upsert({ where: { inventoryNodeId_principalType_principalId: { inventoryNodeId: demo.id, principalType: 'ROLE', principalId: 1 } }, create: { tenantId, inventoryNodeId: demo.id, principalType: 'ROLE', principalId: 1, canView: true, canConnect: true, canEdit: false, canAdmin: false, inheritToChildren: false, createdById: userId }, update: { canView: true, canConnect: true, canEdit: false, canAdmin: false, inheritToChildren: false } })
    await tx.resourceAclEntry.updateMany({ where: { tenantId, inventoryNodeId: root.id, principalType: 'ROLE', principalId: 1 }, data: { canView: true, canConnect: false, canEdit: false, canAdmin: false, inheritToChildren: false } })
    return root.id
  }
  async create(tenantId: number, userId: number, input: unknown): Promise<{ id: number }> {
    this.requireProtectedAddresses()
    const data = await parseInput(input)
    validateTrialCustomAddress(data.ip, this.options.protectedAddresses)
    if ((data.authType === 'password' && !data.password) || (data.authType === 'pem' && !data.privateKey)) throw new ValidationError('Informe as credenciais do host.')
    return this.db.$transaction(async tx => {
      const profile = await this.access(tx, tenantId, userId)
      if (profile.hostAddresses.includes(data.ip)) throw forbidden('TRIAL_DESTINATION_BLOCKED', 'Use o host de demonstração já disponível.')
      const customCount = await tx.host.count({ where: { tenantId, deletedAt: null, ip: { notIn: profile.hostAddresses } } })
      const total = await tx.host.count({ where: { tenantId, deletedAt: null } })
      if (customCount >= profile.maxCustomHosts || profile.requestedMachines + customCount + 1 > profile.maxHosts || total + 1 > profile.maxHosts) throw forbidden('TRIAL_HOST_LIMIT', 'Limite de hosts próprios da degustação atingido.')
      const rootId = await this.isolateDemoAcl(tx, tenantId, userId, profile)
      const pemKeyId = data.authType === 'pem' ? await this.createPem(tx, userId, data) : null
      const host = await tx.host.create({ data: { tenantId, ownerId: userId, scope: 'PERSONAL', name: data.name, ip: data.ip, port: data.port, sshUser: data.sshUser, authType: data.authType === 'pem' ? 'PEM' : 'PASSWORD', pemKeyId, passwordEncrypted: data.password ? JSON.stringify(encrypt(data.password)) : null, accessProtocol: 'SSH', connectionMode: 'DIRECT' } })
      const node = await tx.inventoryNode.create({ data: { tenantId, parentId: rootId, type: 'HOST', hostId: host.id, name: host.name, path: '', depth: 1, createdById: userId } })
      await tx.inventoryNode.update({ where: { id: node.id }, data: { path: `/${node.id}/` } })
      await tx.resourceAclEntry.create({ data: { tenantId, inventoryNodeId: node.id, principalType: 'USER', principalId: userId, canView: true, canConnect: true, canEdit: true, canAdmin: false, inheritToChildren: false, createdById: userId } })
      return { id: host.id }
    })
  }
  async update(tenantId: number, userId: number, hostId: number, input: unknown): Promise<{ id: number }> {
    this.requireProtectedAddresses()
    const data = await parseInput(input)
    validateTrialCustomAddress(data.ip, this.options.protectedAddresses)
    return this.db.$transaction(async tx => {
      const profile = await this.access(tx, tenantId, userId)
      const host = await this.ownHost(tx, profile, tenantId, userId, hostId)
      if (profile.hostAddresses.includes(data.ip)) throw forbidden('TRIAL_DESTINATION_BLOCKED', 'Use o host de demonstração já disponível.')
      const authType = data.authType === 'pem' ? 'PEM' : 'PASSWORD'
      if (authType !== host.authType && !data.password && !data.privateKey) throw new ValidationError('Informe as credenciais para alterar o método de autenticação.')
      const pemKeyId = data.authType === 'pem' ? (data.privateKey ? await this.createPem(tx, userId, data) : host.pemKeyId) : null
      await tx.host.update({ where: { id: host.id }, data: { name: data.name, ip: data.ip, port: data.port, sshUser: data.sshUser, authType, pemKeyId, passwordEncrypted: data.authType === 'password' ? (data.password ? JSON.stringify(encrypt(data.password)) : host.passwordEncrypted) : null,
        ...(data.ip !== host.ip || data.port !== host.port ? { trustedHostKeyFingerprint: null, trustedHostKeyVerifiedAt: null, trustedHostKeyVerifiedBy: null } : {}) } })
      await tx.inventoryNode.updateMany({ where: { tenantId, hostId }, data: { name: data.name } })
      if (pemKeyId !== host.pemKeyId) await this.discardPem(tx, userId, host.pemKeyId)
      return { id: host.id }
    })
  }
  async remove(tenantId: number, userId: number, hostId: number): Promise<void> {
    await this.db.$transaction(async tx => {
      const profile = await this.access(tx, tenantId, userId)
      const host = await this.ownHost(tx, profile, tenantId, userId, hostId)
      await tx.host.update({ where: { id: hostId }, data: { deletedAt: new Date(), passwordEncrypted: null, pemKeyId: null } })
      await tx.inventoryNode.updateMany({ where: { tenantId, hostId }, data: { deletedAt: new Date() } })
      await this.discardPem(tx, userId, host.pemKeyId)
    })
  }
  async listCount(tenantId: number, userId: number): Promise<{ count: number; maxCustomHosts: number; remaining: number }> {
    return this.db.$transaction(async tx => {
      const profile = await this.access(tx, tenantId, userId)
      const count = await tx.host.count({ where: { tenantId, deletedAt: null, ip: { notIn: profile.hostAddresses } } })
      return { count, maxCustomHosts: profile.maxCustomHosts, remaining: Math.max(0, Math.min(profile.maxCustomHosts - count, profile.maxHosts - profile.requestedMachines - count)) }
    })
  }
}

/** Revoke only trial-owned keys with no reference from another tenant or a bastion. */
export async function revokeTrialPemKeys(tx: Prisma.TransactionClient, tenantId: number): Promise<number> {
  if (!await tx.trialRegistration.findUnique({ where: { tenantId }, select: { id: true } })) return 0
  const result = await tx.pemKey.updateMany({ where: { createdBy: { tenantId }, hosts: { every: { tenantId } }, bastionHosts: { none: {} } }, data: { name: 'Chave de degustação revogada', encryptedKey: '', iv: '', encryptedPassphrase: null, passphraseIv: null } })
  return result.count
}
