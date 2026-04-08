import type { CreateSecretDto, RotateSecretDto, SecretPublic, UpdateSecretDto } from '@nodeaccess/shared'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { decrypt, encrypt } from '../../shared/crypto.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import type { SecretRepository, SecretRow, SecretScope } from './secret.repository.js'

type UserRole = 'admin' | 'user'
const SECRET_PLACEHOLDER_RE = /\{\{\s*secret:([a-zA-Z0-9._:-]+)\s*\}\}/g

function toPublic(row: SecretRow): SecretPublic {
  return {
    id:          row.id,
    tenantId:    row.tenantId,
    alias:       row.alias,
    description: row.description,
    scope:       row.scope,
    ownerUserId: row.ownerUserId,
    groupId:     row.groupId,
    createdAt:   row.createdAt,
    updatedAt:   row.updatedAt,
    rotatedAt:   row.rotatedAt,
    revokedAt:   row.revokedAt,
  }
}

function safeDetails(row: Pick<SecretRow, 'alias' | 'scope' | 'groupId' | 'revokedAt'>): string {
  return JSON.stringify({
    alias: row.alias,
    scope: row.scope,
    groupId: row.groupId,
    revoked: row.revokedAt !== null,
  })
}

export class SecretService {
  constructor(
    private readonly repo: SecretRepository,
    private readonly logRepo: LogRepository,
    private readonly licenseEntitlementService: LicenseEntitlementService,
  ) {}

  async list(userId: number, tenantId: number, role: UserRole, includeRevoked = false): Promise<SecretPublic[]> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'secrets', 'Secrets não licenciados para este tenant')
    const groupIds = await this.repo.findUserGroupIds(userId)
    const rows = await this.repo.findAccessible({
      tenantId,
      userId,
      groupIds,
      isAdmin: role === 'admin',
      includeRevoked,
    })
    return rows.map(toPublic)
  }

  async create(userId: number, tenantId: number, role: UserRole, dto: CreateSecretDto): Promise<SecretPublic> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'secrets', 'Secrets não licenciados para este tenant')
    const normalized = await this.normalizeScopeInput(userId, tenantId, role, {
      scope: dto.scope ?? 'PERSONAL',
      ...(dto.groupId !== undefined && { groupId: dto.groupId }),
    })
    const encrypted = encrypt(dto.value)

    try {
      const row = await this.repo.create({
        tenantId,
        alias: dto.alias.trim(),
        ...(dto.description !== undefined && { description: dto.description }),
        scope: normalized.scope,
        ...(normalized.ownerUserId !== null && { ownerUserId: normalized.ownerUserId }),
        ...(normalized.groupId !== null && { groupId: normalized.groupId }),
        encryptedValue: encrypted.encrypted,
        iv: encrypted.iv,
      })

      await this.logRepo.logAdminEvent({
        adminId: userId,
        action: 'CREATE_SECRET',
        targetType: 'Secret',
        targetId: row.id,
        details: safeDetails(row),
      }).catch(() => { /* best-effort */ })

      return toPublic(row)
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError(`Secret "${dto.alias}" já existe`)
      }
      throw error
    }
  }

  async update(
    id: number,
    userId: number,
    tenantId: number,
    role: UserRole,
    dto: UpdateSecretDto,
  ): Promise<SecretPublic> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'secrets', 'Secrets não licenciados para este tenant')
    const existing = await this.requireSecret(id, tenantId)
    await this.ensureCanManage(existing, userId, tenantId, role)
    this.ensureActive(existing)

    const normalized =
      dto.scope !== undefined || dto.groupId !== undefined
        ? await this.normalizeScopeInput(userId, tenantId, role, {
          scope: dto.scope ?? existing.scope,
          ...((dto.groupId ?? existing.groupId) !== null && (dto.groupId ?? existing.groupId) !== undefined && {
            groupId: (dto.groupId ?? existing.groupId) as number,
          }),
        })
        : null

    try {
      const row = await this.repo.updateMetadata(tenantId, id, {
        ...(dto.alias !== undefined && { alias: dto.alias.trim() }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(normalized !== null && {
          scope: normalized.scope,
          ownerUserId: normalized.ownerUserId,
          groupId: normalized.groupId,
        }),
      })

      await this.logRepo.logAdminEvent({
        adminId: userId,
        action: 'UPDATE_SECRET',
        targetType: 'Secret',
        targetId: row.id,
        details: safeDetails(row),
      }).catch(() => { /* best-effort */ })

      return toPublic(row)
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError(`Secret "${dto.alias}" já existe`)
      }
      throw error
    }
  }

  async rotate(
    id: number,
    userId: number,
    tenantId: number,
    role: UserRole,
    dto: RotateSecretDto,
  ): Promise<SecretPublic> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'secrets', 'Secrets não licenciados para este tenant')
    const existing = await this.requireSecret(id, tenantId)
    await this.ensureCanManage(existing, userId, tenantId, role)
    this.ensureActive(existing)

    const encrypted = encrypt(dto.value)
    const row = await this.repo.rotate(tenantId, id, encrypted.encrypted, encrypted.iv)

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'ROTATE_SECRET',
      targetType: 'Secret',
      targetId: row.id,
      details: safeDetails(row),
    }).catch(() => { /* best-effort */ })

    return toPublic(row)
  }

  async revoke(id: number, userId: number, tenantId: number, role: UserRole): Promise<SecretPublic> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'secrets', 'Secrets não licenciados para este tenant')
    const existing = await this.requireSecret(id, tenantId)
    await this.ensureCanManage(existing, userId, tenantId, role)

    const row = await this.repo.revoke(tenantId, id)
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'REVOKE_SECRET',
      targetType: 'Secret',
      targetId: row.id,
      details: safeDetails(row),
    }).catch(() => { /* best-effort */ })

    return toPublic(row)
  }

  async delete(id: number, userId: number, tenantId: number, role: UserRole): Promise<void> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'secrets', 'Secrets não licenciados para este tenant')
    const existing = await this.requireSecret(id, tenantId)
    await this.ensureCanManage(existing, userId, tenantId, role)

    await this.repo.delete(tenantId, id)
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'DELETE_SECRET',
      targetType: 'Secret',
      targetId: existing.id,
      details: safeDetails(existing),
    }).catch(() => { /* best-effort */ })
  }

  async resolvePlaceholders(
    userId: number,
    tenantId: number,
    role: UserRole,
    text: string,
    context: {
      resourceType: string
      resourceId?: number
      sessionId?: number
      hostId?: number
    },
  ): Promise<{ text: string; maskedText: string; aliases: string[]; redactions: Array<{ alias: string; value: string }> }> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'secrets', 'Secrets não licenciados para este tenant')
    const aliases = extractSecretAliases(text)
    if (aliases.length === 0) return { text, maskedText: text, aliases: [], redactions: [] }

    const groupIds = await this.repo.findUserGroupIds(userId)
    const rows = await this.repo.findAccessibleByAliases({
      tenantId,
      userId,
      groupIds,
      isAdmin: role === 'admin',
      aliases,
    })
    const byAlias = new Map(rows.map((row) => [row.alias, row]))
    const missing = aliases.filter((alias) => !byAlias.has(alias))
    if (missing.length > 0) {
      throw new ForbiddenError(`Sem permissão para usar secret: ${missing.join(', ')}`)
    }

    let resolvedText = text
    let maskedText = text
    const redactions: Array<{ alias: string; value: string }> = []

    for (const alias of aliases) {
      const row = byAlias.get(alias)
      if (!row) continue
      const value = decrypt({ encrypted: row.encryptedValue, iv: row.iv })
      redactions.push({ alias, value })
      const placeholder = new RegExp(`\\{\\{\\s*secret:${escapeRegExp(alias)}\\s*\\}\\}`, 'g')
      resolvedText = resolvedText.replace(placeholder, value)
      maskedText = maskedText.replace(placeholder, `{{secret:${alias}:***}}`)

      await this.logRepo.logAdminEvent({
        adminId: userId,
        action: 'USE_SECRET',
        targetType: 'Secret',
        targetId: row.id,
        details: JSON.stringify({
          alias,
          scope: row.scope,
          groupId: row.groupId,
          resourceType: context.resourceType,
          resourceId: context.resourceId,
          sessionId: context.sessionId,
          hostId: context.hostId,
        }),
      }).catch(() => { /* best-effort */ })
    }

    return { text: resolvedText, maskedText, aliases, redactions }
  }

  private async requireSecret(id: number, tenantId: number): Promise<SecretRow> {
    const row = await this.repo.findById(tenantId, id)
    if (!row) throw new NotFoundError('Secret')
    return row
  }

  private async ensureCanManage(row: SecretRow, userId: number, tenantId: number, role: UserRole): Promise<void> {
    if (role === 'admin') return
    if (row.ownerUserId === userId) return

    if (row.scope === 'GROUP' && row.groupId !== null) {
      const groupIds = await this.repo.findUserGroupIds(userId)
      if (groupIds.includes(row.groupId)) return
    }

    if (row.tenantId !== tenantId) throw new NotFoundError('Secret')
    throw new ForbiddenError('Sem permissão para gerenciar este secret')
  }

  private ensureActive(row: SecretRow): void {
    if (row.revokedAt !== null) {
      throw new AppError('Secret revogado', 409, 'SECRET_REVOKED')
    }
  }

  private async normalizeScopeInput(
    userId: number,
    tenantId: number,
    role: UserRole,
    input: { scope: SecretScope; groupId?: number },
  ): Promise<{ scope: SecretScope; ownerUserId: number | null; groupId: number | null }> {
    if (input.scope === 'PERSONAL') {
      return { scope: 'PERSONAL', ownerUserId: userId, groupId: null }
    }

    if (input.scope === 'TENANT') {
      if (role !== 'admin') throw new ForbiddenError('Apenas admin pode criar secret de tenant')
      return { scope: 'TENANT', ownerUserId: null, groupId: null }
    }

    if (!input.groupId) {
      throw new AppError('groupId é obrigatório para secret de grupo', 400, 'SECRET_GROUP_REQUIRED')
    }

    const exists = await this.repo.groupExistsInTenant(input.groupId, tenantId)
    if (!exists) throw new NotFoundError('Grupo')

    if (role !== 'admin') {
      const groupIds = await this.repo.findUserGroupIds(userId)
      if (!groupIds.includes(input.groupId)) throw new ForbiddenError('Sem permissão para este grupo')
    }

    return { scope: 'GROUP', ownerUserId: null, groupId: input.groupId }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  const err = error as { code?: string; message?: string }
  return err.code === 'P2002' || err.message?.includes('secrets_tenant_id_alias_key') === true
}

function extractSecretAliases(text: string): string[] {
  const aliases = new Set<string>()
  for (const match of text.matchAll(SECRET_PLACEHOLDER_RE)) {
    if (match[1]) aliases.add(match[1])
  }
  return [...aliases]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
