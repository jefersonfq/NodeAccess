import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'

export class ScimError extends Error {
  constructor(public readonly status: number, message: string, public readonly scimType?: string) {
    super(message)
  }
}

export interface ScimUserInput {
  userName?: string
  externalId?: string
  active?: boolean
  displayName?: string
  name?: { formatted?: string; givenName?: string; familyName?: string }
  emails?: Array<{ value?: string; primary?: boolean }>
  password?: string
}

export interface ScimGroupInput {
  displayName?: string
  externalId?: string
  members?: Array<{ value?: string }>
}

export class ScimService {
  constructor(private readonly db: PrismaClient, private readonly entitlements: LicenseEntitlementService) {}

  async getAdminConfig(tenantId: number) {
    await this.requireLicensed(tenantId)
    const config = await this.db.scimConfig.findUnique({ where: { tenantId } })
    return { enabled: config?.enabled ?? false, tokenConfigured: Boolean(config?.tokenHash), tokenPrefix: config?.tokenPrefix ?? null, rotatedAt: config?.rotatedAt ?? null }
  }

  async rotateToken(tenantId: number) {
    await this.requireLicensed(tenantId)
    const token = `na_scim_${randomBytes(32).toString('base64url')}`
    const now = new Date()
    await this.db.scimConfig.upsert({
      where: { tenantId },
      create: { tenantId, enabled: false, tokenHash: tokenHash(token), tokenPrefix: token.slice(0, 14), rotatedAt: now },
      update: { enabled: false, tokenHash: tokenHash(token), tokenPrefix: token.slice(0, 14), rotatedAt: now },
    })
    return { token, enabled: false, tokenPrefix: token.slice(0, 14), rotatedAt: now }
  }

  async setEnabled(tenantId: number, enabled: boolean) {
    await this.requireLicensed(tenantId)
    const config = await this.db.scimConfig.findUnique({ where: { tenantId } })
    if (enabled && !config?.tokenHash) throw new ScimError(409, 'Gere uma credencial SCIM antes de ativar')
    const updated = await this.db.scimConfig.upsert({ where: { tenantId }, create: { tenantId, enabled }, update: { enabled } })
    return { enabled: updated.enabled, tokenConfigured: Boolean(updated.tokenHash), tokenPrefix: updated.tokenPrefix, rotatedAt: updated.rotatedAt }
  }

  async authenticate(authorization: string | undefined): Promise<number> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token || token.length > 256) throw new ScimError(401, 'Credencial SCIM inválida')
    const hash = tokenHash(token)
    const config = await this.db.scimConfig.findFirst({ where: { tokenHash: hash, enabled: true }, select: { tenantId: true, tokenHash: true } })
    if (!config?.tokenHash || !safeEqual(hash, config.tokenHash)) throw new ScimError(401, 'Credencial SCIM inválida')
    await this.requireLicensed(config.tenantId)
    return config.tenantId
  }

  async listUsers(tenantId: number, filter?: string) {
    const email = parseUserNameFilter(filter)
    const rows = await this.db.scimUser.findMany({
      where: { tenantId, ...(email ? { user: { email } } : {}) }, include: { user: true }, orderBy: { createdAt: 'asc' }, take: 200,
    })
    return listResponse(rows.map((row) => scimUser(row)))
  }

  async getUser(tenantId: number, id: string) {
    const row = await this.db.scimUser.findFirst({ where: { id, tenantId }, include: { user: true } })
    if (!row) throw new ScimError(404, 'Usuário SCIM não encontrado')
    return scimUser(row)
  }

  async createUser(tenantId: number, input: ScimUserInput) {
    const email = normalizedEmail(input)
    const name = displayName(input, email)
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`
      const existing = await tx.user.findFirst({ where: { tenantId, email, deletedAt: null }, include: { scimIdentity: true } })
      if (existing && !existing.scimIdentity) throw new ScimError(409, 'O e-mail já pertence a uma conta não gerenciada pelo SCIM', 'uniqueness')
      if (existing?.scimIdentity) throw new ScimError(409, 'Usuário SCIM já existe', 'uniqueness')
      const license = await tx.license.findUnique({ where: { tenantId } })
      const activeUsers = await tx.user.count({ where: { tenantId, active: true, licenseConsumed: true, deletedAt: null } })
      if (!license || activeUsers >= license.maxUsers) throw new ScimError(409, 'Limite de usuários do tenant atingido')
      const user = await tx.user.create({ data: {
        tenantId, email, name, role: 'USER', active: input.active !== false,
        canManageHosts: false, canViewLiveSessions: false, forcePasswordChange: false,
        licenseConsumed: input.active !== false,
      } })
      const mapping = await tx.scimUser.create({ data: { id: randomUUID(), tenantId, userId: user.id, externalId: input.externalId ?? null } })
      return { ...mapping, user }
    })
    await this.audit(tenantId, 'CREATE', 'User', result.id, { active: result.user.active })
    return scimUser(result)
  }

  async replaceUser(tenantId: number, id: string, input: ScimUserInput) {
    const email = normalizedEmail(input)
    const row = await this.db.scimUser.findFirst({ where: { id, tenantId }, include: { user: true } })
    if (!row) throw new ScimError(404, 'Usuário SCIM não encontrado')
    const active = input.active !== false
    const user = await this.db.user.update({ where: { id: row.userId }, data: {
      email, name: displayName(input, email), active, licenseConsumed: active,
      ...(active === row.user.active ? {} : { sessionVersion: { increment: 1 } }),
    } })
    const mapping = await this.db.scimUser.update({ where: { id }, data: { externalId: input.externalId ?? null } })
    await this.audit(tenantId, 'REPLACE', 'User', id, { active })
    return scimUser({ ...mapping, user })
  }

  async patchUser(tenantId: number, id: string, operations: Array<{ op?: string; path?: string; value?: unknown }>) {
    const row = await this.db.scimUser.findFirst({ where: { id, tenantId }, include: { user: true } })
    if (!row) throw new ScimError(404, 'Usuário SCIM não encontrado')
    let active = row.user.active
    for (const operation of operations) {
      if (operation.op?.toLowerCase() === 'replace' && operation.path?.toLowerCase() === 'active' && typeof operation.value === 'boolean') active = operation.value
      if (operation.op?.toLowerCase() === 'replace' && !operation.path && operation.value && typeof operation.value === 'object' && 'active' in operation.value) active = Boolean((operation.value as { active: unknown }).active)
    }
    if (active !== row.user.active) await this.db.user.update({ where: { id: row.userId }, data: { active, licenseConsumed: active, sessionVersion: { increment: 1 } } })
    await this.audit(tenantId, 'PATCH', 'User', id, { active })
    return this.getUser(tenantId, id)
  }

  async listGroups(tenantId: number) {
    const rows = await this.db.scimGroup.findMany({ where: { tenantId }, include: { group: { include: { users: { where: { source: 'SCIM' }, include: { user: { include: { scimIdentity: true } } } } } } }, take: 200 })
    return listResponse(rows.map(scimGroup))
  }

  async createGroup(tenantId: number, input: ScimGroupInput) {
    const displayName = input.displayName?.trim()
    if (!displayName) throw new ScimError(400, 'displayName é obrigatório', 'invalidValue')
    const result = await this.db.$transaction(async (tx) => {
      const group = await tx.group.create({ data: { tenantId, name: displayName, description: 'Gerenciado via SCIM' } })
      const mapping = await tx.scimGroup.create({ data: { id: randomUUID(), tenantId, groupId: group.id, externalId: input.externalId ?? null } })
      return { ...mapping, group: { ...group, users: [] } }
    })
    if (input.members?.length) await this.replaceGroupMembers(tenantId, result.id, input.members)
    await this.audit(tenantId, 'CREATE', 'Group', result.id, { memberCount: input.members?.length ?? 0 })
    return this.getGroup(tenantId, result.id)
  }

  async getGroup(tenantId: number, id: string) {
    const row = await this.db.scimGroup.findFirst({ where: { id, tenantId }, include: { group: { include: { users: { where: { source: 'SCIM' }, include: { user: { include: { scimIdentity: true } } } } } } } })
    if (!row) throw new ScimError(404, 'Grupo SCIM não encontrado')
    return scimGroup(row)
  }

  async replaceGroup(tenantId: number, id: string, input: ScimGroupInput) {
    const row = await this.db.scimGroup.findFirst({ where: { id, tenantId } })
    if (!row) throw new ScimError(404, 'Grupo SCIM não encontrado')
    const displayName = input.displayName?.trim()
    if (!displayName) throw new ScimError(400, 'displayName é obrigatório', 'invalidValue')
    await this.db.group.update({ where: { id: row.groupId }, data: { name: displayName } })
    await this.db.scimGroup.update({ where: { id }, data: { externalId: input.externalId ?? null } })
    await this.replaceGroupMembers(tenantId, id, input.members ?? [])
    await this.audit(tenantId, 'REPLACE', 'Group', id, { memberCount: input.members?.length ?? 0 })
    return this.getGroup(tenantId, id)
  }

  async patchGroup(tenantId: number, id: string, operations: Array<{ op?: string; path?: string; value?: unknown }>) {
    const current = await this.getGroup(tenantId, id) as { displayName: string; members: Array<{ value: string }> }
    let displayName = current.displayName
    let memberIds = current.members.map((member) => member.value)
    for (const operation of operations) {
      const op = operation.op?.toLowerCase()
      const path = operation.path?.toLowerCase()
      if (op === 'replace' && path === 'displayname' && typeof operation.value === 'string') displayName = operation.value.trim()
      if (path === 'members' || !path) {
        const value = Array.isArray(operation.value) ? operation.value : []
        const ids = value.flatMap((member) => member && typeof member === 'object' && 'value' in member && typeof member.value === 'string' ? [member.value] : [])
        if (op === 'replace') memberIds = ids
        if (op === 'add') memberIds = [...new Set([...memberIds, ...ids])]
      }
      const removeMatch = operation.path?.match(/^members\[value eq "([^"\\]+)"\]$/i)
      if (op === 'remove' && removeMatch) memberIds = memberIds.filter((memberId) => memberId !== removeMatch[1])
      if (op === 'remove' && path === 'members') memberIds = []
    }
    const mapping = await this.db.scimGroup.findFirst({ where: { id, tenantId } })
    if (!mapping) throw new ScimError(404, 'Grupo SCIM não encontrado')
    await this.db.group.update({ where: { id: mapping.groupId }, data: { name: displayName } })
    await this.replaceGroupMembers(tenantId, id, memberIds.map((value) => ({ value })))
    await this.audit(tenantId, 'PATCH', 'Group', id, { memberCount: memberIds.length })
    return this.getGroup(tenantId, id)
  }

  private async replaceGroupMembers(tenantId: number, id: string, members: Array<{ value?: string }>) {
    const mapping = await this.db.scimGroup.findFirst({ where: { id, tenantId } })
    if (!mapping) throw new ScimError(404, 'Grupo SCIM não encontrado')
    const memberIds = [...new Set(members.map((member) => member.value).filter((value): value is string => Boolean(value)))]
    const users = memberIds.length ? await this.db.scimUser.findMany({ where: { tenantId, id: { in: memberIds } }, select: { userId: true } }) : []
    if (users.length !== memberIds.length) throw new ScimError(400, 'Um ou mais membros não pertencem ao tenant', 'invalidValue')
    await this.db.$transaction(async (tx) => {
      await tx.userGroup.deleteMany({ where: { groupId: mapping.groupId, source: 'SCIM' } })
      for (const user of users) {
        const existing = await tx.userGroup.findUnique({ where: { userId_groupId: { userId: user.userId, groupId: mapping.groupId } } })
        if (!existing) await tx.userGroup.create({ data: { userId: user.userId, groupId: mapping.groupId, source: 'SCIM' } })
      }
    })
  }

  private requireLicensed(tenantId: number) {
    return this.entitlements.requireIntegrationProvider(tenantId, 'scim', 'SCIM não está disponível na licença deste tenant')
  }

  private async audit(tenantId: number, action: string, resourceType: 'User' | 'Group', resourceId: string, details: Record<string, unknown>) {
    await this.db.scimAuditEvent.create({ data: { tenantId, action, resourceType, resourceId, details: JSON.stringify(details) } })
  }
}

function tokenHash(token: string) { return createHash('sha256').update(token, 'utf8').digest('hex') }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b) }
function parseUserNameFilter(filter?: string) {
  if (!filter) return undefined
  const match = filter.match(/^userName\s+eq\s+"([^"\\]{3,320})"$/i)
  if (!match) throw new ScimError(400, 'Filtro SCIM não suportado', 'invalidFilter')
  return match[1]!.trim().toLowerCase()
}
function normalizedEmail(input: ScimUserInput) {
  const value = input.userName ?? input.emails?.find((email) => email.primary)?.value ?? input.emails?.[0]?.value
  const email = value?.trim().toLowerCase()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ScimError(400, 'userName deve ser um e-mail válido', 'invalidValue')
  return email
}
function displayName(input: ScimUserInput, fallback: string) { return input.displayName?.trim() || input.name?.formatted?.trim() || [input.name?.givenName, input.name?.familyName].filter(Boolean).join(' ').trim() || fallback }
function listResponse(Resources: unknown[]) { return { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: Resources.length, startIndex: 1, itemsPerPage: Resources.length, Resources } }
function scimUser(row: { id: string; externalId: string | null; createdAt: Date; updatedAt: Date; user: { email: string; name: string; active: boolean } }) { return { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], id: row.id, externalId: row.externalId ?? undefined, userName: row.user.email, displayName: row.user.name, active: row.user.active, emails: [{ value: row.user.email, primary: true }], meta: { resourceType: 'User', created: row.createdAt, lastModified: row.updatedAt } } }
function scimGroup(row: { id: string; externalId: string | null; createdAt: Date; updatedAt: Date; group: { name: string; users: Array<{ user: { scimIdentity: { id: string } | null } }> } }) { return { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], id: row.id, externalId: row.externalId ?? undefined, displayName: row.group.name, members: row.group.users.flatMap((membership) => membership.user.scimIdentity ? [{ value: membership.user.scimIdentity.id }] : []), meta: { resourceType: 'Group', created: row.createdAt, lastModified: row.updatedAt } } }
