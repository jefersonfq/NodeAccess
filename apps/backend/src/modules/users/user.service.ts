import bcrypt from 'bcrypt'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Prisma } from '@prisma/client'
import type { User } from '@prisma/client'
import type { UserPublic, CreateUserDto, UpdateUserDto, UserPreferences, PatchUserPreferencesDto } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'
import { UserPreferencesSchema } from '@nodeaccess/shared'
import {
  NotFoundError,
  ConflictError,
  LicenseLimitError,
  ForbiddenError,
  ValidationError,
} from '../../shared/errors.js'
import { env } from '../../config/env.js'
import type { UserInventoryAccessRow, UserRepository, UserFilters } from './user.repository.js'
import type { WebhookService } from '../webhooks/webhook.service.js'
import type { AppEventBus } from '../app-events/app-event.bus.js'
import { avatarUrlFor, avatarVersionFor } from './avatar-url.js'

const BCRYPT_ROUNDS = 12
const MAX_AVATAR_BYTES = 512 * 1024

function toPublic(user: User, groupIds: number[] = [], canViewLiveSessions = false): UserPublic {
  const avatarUpdatedAt = (user as User & { avatarUpdatedAt?: Date | null }).avatarUpdatedAt ?? null
  return {
    id:             user.id,
    tenantId:       user.tenantId,
    name:           user.name,
    email:          user.email,
    role:           user.role === 'ADMIN' ? 'admin' : 'user',
    isPlatformAdmin:user.isPlatformAdmin,
    canManageHosts: user.canManageHosts,
    canViewLiveSessions,
    avatarUrl:      avatarUrlFor(user.id, avatarUpdatedAt),
    avatarVersion:  avatarVersionFor(avatarUpdatedAt),
    mfaEnabled:     user.mfaEnabled,
    active:         user.active,
    groupIds,
    deletedAt:      user.deletedAt ?? undefined,
    createdAt:      user.createdAt,
    updatedAt:      user.updatedAt,
  }
}

function userAvatarPath(tenantId: number, userId: number): string {
  const tenantHash = createHash('sha256').update(String(tenantId)).digest('hex').slice(0, 16)
  return join(env.USER_AVATAR_STORAGE_DIR, tenantHash, `${userId}.avatar`)
}

function detectAvatarMime(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

function withAvatarMetadata(user: User, avatarUpdatedAt: Date | null | undefined): User {
  return { ...user, avatarUpdatedAt: avatarUpdatedAt ?? null } as User
}

export interface UserInventoryAccessPublic {
  aclEntryId: number
  inventoryNodeId: number
  inventoryNodeName: string
  inventoryNodeType: 'ROOT' | 'FOLDER' | 'HOST'
  principalType: 'USER' | 'GROUP' | 'ROLE'
  principalId: number
  principalName: string
  permissions: {
    view: boolean
    connect: boolean
    edit: boolean
    admin: boolean
  }
  inheritToChildren: boolean
  hostCount: number
  updatedAt: Date
}

function toInventoryAccessPublic(row: UserInventoryAccessRow): UserInventoryAccessPublic {
  return {
    aclEntryId: row.aclEntryId,
    inventoryNodeId: row.inventoryNodeId,
    inventoryNodeName: row.inventoryNodeName,
    inventoryNodeType: row.inventoryNodeType,
    principalType: row.principalType,
    principalId: row.principalId,
    principalName: row.principalName,
    permissions: {
      view: Boolean(row.canView),
      connect: Boolean(row.canConnect),
      edit: Boolean(row.canEdit),
      admin: Boolean(row.canAdmin),
    },
    inheritToChildren: Boolean(row.inheritToChildren),
    hostCount: Number(row.hostCount),
    updatedAt: row.updatedAt,
  }
}

function mapRole(role: 'admin' | 'user'): 'ADMIN' | 'USER' {
  return role === 'admin' ? 'ADMIN' : 'USER'
}

function sameNumberSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

const DEFAULT_USER_PREFERENCES: UserPreferences = UserPreferencesSchema.parse({
  ui: {
    themeMode: 'dark',
    autoCollapseSidebarOnTerminal: false,
  },
  terminal: {
    preset: 'auto',
    fontSize: 14,
    fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
    theme: 'one-dark',
    rightClickMode: 'paste',
    multilinePasteMode: 'always',
    autoFullscreenOnConnect: false,
    graphicalOpenMode: 'dedicated',
    snippetShortcutMode: 'default',
    hostSwitcherShortcutMode: 'default',
    showTerminalToolbar: true,
    sidebarRailPosition: 'right',
    autocompleteEnabled: true,
    aiAssistantEnabled: true,
  },
  hosts: {
    displayMode: 'cards',
    favoriteHostIds: [],
    recentHostIds: [],
    quickAccessCollapsed: true,
    productivityCollapsed: false,
    hostsDefaultView: 'home',
    homeMaxFavorites: 6,
    homeMaxRecents: 6,
    sidebarWidth: 224,
  },
  snippets: {
    pickerView: 'flat',
    pageView: 'flat',
  },
})

function normalizePreferences(input: unknown): UserPreferences {
  if (!input || typeof input !== 'object') return DEFAULT_USER_PREFERENCES

    return UserPreferencesSchema.parse({
    ui: {
      ...DEFAULT_USER_PREFERENCES.ui,
      ...((input as { ui?: unknown }).ui as Record<string, unknown> | undefined),
    },
    terminal: {
      ...DEFAULT_USER_PREFERENCES.terminal,
      ...((input as { terminal?: unknown }).terminal as Record<string, unknown> | undefined),
    },
    hosts: {
      ...DEFAULT_USER_PREFERENCES.hosts,
      ...((input as { hosts?: unknown }).hosts as Record<string, unknown> | undefined),
    },
    snippets: {
      ...DEFAULT_USER_PREFERENCES.snippets,
      ...((input as { snippets?: unknown }).snippets as Record<string, unknown> | undefined),
    },
  })
}

export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly webhookService: WebhookService,
    private readonly appEventBus?: AppEventBus,
  ) {}

  async list(
    tenantId: number,
    filters: UserFilters,
  ): Promise<Paginated<UserPublic>> {
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 20
    const { users, total } = await this.userRepo.findAll(tenantId, filters)
    const groupMap = await this.userRepo.findGroupIdsByUsers(users.map((u) => u.id))
    const liveSessionPermissionMap = await this.userRepo.findLiveSessionsPermissionsByUsers(users.map((u) => u.id))
    const avatarMap = await this.userRepo.findAvatarMetadataByUsers(users.map((u) => u.id))
    return {
      data: users.map((u) => toPublic(
        withAvatarMetadata(u, avatarMap.get(u.id)?.avatarUpdatedAt),
        groupMap.get(u.id) ?? [],
        liveSessionPermissionMap.get(u.id) ?? false,
      )),
      total,
      page,
      limit,
    }
  }

  async getById(id: number, tenantId: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenantIncludingDeleted(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')
    const groupIds = await this.userRepo.findGroupIdsByUser(id)
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(id)
    const avatar = await this.userRepo.findAvatarMetadata(id, tenantId)
    return toPublic(withAvatarMetadata(user, avatar?.avatarUpdatedAt), groupIds, canViewLiveSessions)
  }

  async listInventoryAccess(id: number, tenantId: number): Promise<UserInventoryAccessPublic[]> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')
    return (await this.userRepo.findInventoryAccessSources(id, tenantId)).map(toInventoryAccessPublic)
  }

  async softDelete(id: number, tenantId: number, adminId?: number): Promise<void> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')
    await this.userRepo.softDelete(id)
    if (adminId) {
      await this.userRepo.logAdminEvent({ adminId, action: 'DELETE_USER', targetType: 'User', targetId: id }).catch(() => {})
    }
  }

  async restore(id: number, tenantId: number, adminId?: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenantIncludingDeleted(id, tenantId)
    if (!user || !user.deletedAt) throw new NotFoundError('Usuário excluído')

    const license = await this.userRepo.findLicenseByTenant(tenantId)
    if (license) {
      const activeCount = await this.userRepo.countActiveByTenant(tenantId)
      if (activeCount >= license.maxUsers) throw new LicenseLimitError()
    }

    await this.userRepo.restore(id)
    if (adminId) {
      await this.userRepo.logAdminEvent({ adminId, action: 'RESTORE_USER', targetType: 'User', targetId: id }).catch(() => {})
    }
    const groupIds = await this.userRepo.findGroupIdsByUser(id)
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(id)
    const avatar = await this.userRepo.findAvatarMetadata(id, tenantId)
    return toPublic(withAvatarMetadata({ ...user, deletedAt: null, active: true, licenseConsumed: true } as User, avatar?.avatarUpdatedAt), groupIds, canViewLiveSessions)
  }

  async create(
    dto: CreateUserDto,
    tenantId: number,
    adminId?: number,
  ): Promise<UserPublic & { temporaryPassword?: string }> {
    // Verificar limite de licença
    const license = await this.userRepo.findLicenseByTenant(tenantId)
    if (license) {
      const activeCount = await this.userRepo.countActiveByTenant(tenantId)
      if (activeCount >= license.maxUsers) throw new LicenseLimitError()
    }

    // Verificar e-mail único no tenant
    const existing = await this.userRepo.findByEmail(dto.email, tenantId)
    if (existing) throw new ConflictError('E-mail já cadastrado neste tenant')

    const passwordRegex = new RegExp(env.PASSWORD_POLICY_REGEX)

    let finalPassword: string
    let temporaryPassword: string | undefined

    if (dto.password) {
      if (!passwordRegex.test(dto.password)) {
        throw new ValidationError(env.PASSWORD_POLICY_DESCRIPTION || 'Senha não atende à política de segurança')
      }
      finalPassword = dto.password
    } else {
      // Gerar senha temporária
      const generated = randomBytes(12).toString('base64url')
      // Senhas base64url podem não satisfazer a política — garantir letras maiúsculas
      temporaryPassword = passwordRegex.test(generated) ? generated : `A1${generated}`
      finalPassword = temporaryPassword
    }

    const passwordHash = await bcrypt.hash(finalPassword, BCRYPT_ROUNDS)

    const user = await this.userRepo.create({
      name:           dto.name,
      email:          dto.email,
      passwordHash,
      role:           mapRole(dto.role),
      canManageHosts: dto.canManageHosts,
      canViewLiveSessions: dto.canViewLiveSessions,
      tenantId,
      groupIds:       dto.groupIds,
    })

    if (adminId) {
      await this.userRepo.logAdminEvent({ adminId, action: 'CREATE_USER', targetType: 'User', targetId: user.id }).catch(() => { /* best-effort */ })
    }
    void this.webhookService.publishEvent({
      tenantId, eventType: 'user.created', eventVersion: 1,
      resourceType: 'user', resourceId: String(user.id),
      occurredAt: new Date(), data: { name: user.name, email: user.email, role: user.role },
    }).catch(() => {})
    return { ...toPublic(user, [], dto.canViewLiveSessions), ...(temporaryPassword !== undefined && { temporaryPassword }) }
  }

  async update(id: number, dto: UpdateUserDto, tenantId: number, adminId?: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')
    const previousGroupIds = dto.groupIds !== undefined
      ? await this.userRepo.findGroupIdsByUser(id)
      : []

    const updated = await this.userRepo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.role !== undefined && { role: mapRole(dto.role) }),
      ...(dto.canManageHosts !== undefined && { canManageHosts: dto.canManageHosts }),
      ...(dto.canViewLiveSessions !== undefined && { canViewLiveSessions: dto.canViewLiveSessions }),
      ...(dto.groupIds !== undefined && { groupIds: dto.groupIds }),
    })

    if (adminId) {
      await this.userRepo.logAdminEvent({ adminId, action: 'UPDATE_USER', targetType: 'User', targetId: id }).catch(() => { /* best-effort */ })
    }
    const groupIds = dto.groupIds !== undefined ? dto.groupIds : await this.userRepo.findGroupIdsByUser(id)
    if (dto.groupIds !== undefined && !sameNumberSet(previousGroupIds, groupIds)) {
      await this.appEventBus?.publish({
        type: 'user_acl_membership_changed',
        tenantId,
        userId: id,
        actorId: adminId ?? id,
        previousGroupIds,
        nextGroupIds: groupIds,
        changedAt: new Date().toISOString(),
      }).catch(() => { /* best-effort realtime */ })
    }
    const canViewLiveSessions = dto.canViewLiveSessions ?? await this.userRepo.canViewLiveSessions(id)
    const avatar = await this.userRepo.findAvatarMetadata(id, tenantId)
    return toPublic(withAvatarMetadata(updated, avatar?.avatarUpdatedAt), groupIds, canViewLiveSessions)
  }

  async setActive(id: number, active: boolean, tenantId: number, adminId?: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')

    // Verificar licença ao reativar
    if (active) {
      const license = await this.userRepo.findLicenseByTenant(tenantId)
      if (license) {
        const activeCount = await this.userRepo.countActiveByTenant(tenantId)
        if (activeCount >= license.maxUsers) throw new LicenseLimitError()
      }
    }

    await this.userRepo.setActive(id, active)
    if (adminId) {
      const action = active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER'
      await this.userRepo.logAdminEvent({ adminId, action, targetType: 'User', targetId: id }).catch(() => { /* best-effort */ })
    }
    void this.webhookService.publishEvent({
      tenantId, eventType: active ? 'user.activated' : 'user.deactivated', eventVersion: 1,
      resourceType: 'user', resourceId: String(id),
      occurredAt: new Date(), data: { name: user.name, email: user.email },
    }).catch(() => {})
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(id)
    const avatar = await this.userRepo.findAvatarMetadata(id, tenantId)
    return toPublic(withAvatarMetadata({ ...user, active, licenseConsumed: active } as User, avatar?.avatarUpdatedAt), [], canViewLiveSessions)
  }

  async resetPassword(id: number, tenantId: number, adminId?: number): Promise<{ temporaryPassword: string }> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')

    const temporaryPassword = `A1${randomBytes(12).toString('base64url')}`
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS)

    await this.userRepo.updatePassword(id, passwordHash)
    await this.userRepo.setForcePasswordChange(id, true)

    if (adminId) {
      await this.userRepo.logAdminEvent({ adminId, action: 'RESET_PASSWORD', targetType: 'User', targetId: id }).catch(() => { /* best-effort */ })
    }
    return { temporaryPassword }
  }

  async resetMfa(id: number, tenantId: number, adminId?: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')

    await this.userRepo.resetMfa(id)

    if (adminId) {
      await this.userRepo.logAdminEvent({
        adminId,
        action: 'RESET_MFA',
        targetType: 'User',
        targetId: id,
        details: JSON.stringify({ email: user.email }),
      }).catch(() => { /* best-effort */ })
    }

    const groupIds = await this.userRepo.findGroupIdsByUser(id)
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(id)
    const avatar = await this.userRepo.findAvatarMetadata(id, tenantId)
    return toPublic(withAvatarMetadata({ ...user, mfaEnabled: false, mfaSecret: null, failedLoginAttempts: 0, lockedUntil: null } as User, avatar?.avatarUpdatedAt), groupIds, canViewLiveSessions)
  }

  async changePassword(
    id: number,
    tenantId: number,
    currentPassword: string | undefined,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user?.passwordHash) throw new NotFoundError('Usuário')

    if (!user.forcePasswordChange) {
      if (!currentPassword) throw new ForbiddenError('Senha atual incorreta')

      const valid = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!valid) throw new ForbiddenError('Senha atual incorreta')
    }

    const passwordRegex = new RegExp(env.PASSWORD_POLICY_REGEX)
    if (!passwordRegex.test(newPassword)) {
      throw new ValidationError(env.PASSWORD_POLICY_DESCRIPTION)
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await this.userRepo.updatePassword(id, passwordHash)
  }

  async getPreferences(id: number, tenantId: number): Promise<UserPreferences | null> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')

    const stored = await this.userRepo.findPreferencesByIdInTenant(id, tenantId)
    if (!stored) return null
    return normalizePreferences(stored)
  }

  async updatePreferences(
    id: number,
    tenantId: number,
    patch: PatchUserPreferencesDto,
  ): Promise<UserPreferences> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')

    const current = normalizePreferences(await this.userRepo.findPreferencesByIdInTenant(id, tenantId))
    const next = UserPreferencesSchema.parse({
      ui: {
        ...current.ui,
        ...(patch.ui ?? {}),
      },
      terminal: {
        ...current.terminal,
        ...(patch.terminal ?? {}),
      },
      hosts: {
        ...current.hosts,
        ...(patch.hosts ?? {}),
      },
    })

    await this.userRepo.updatePreferences(id, next as Prisma.InputJsonValue)
    return next
  }

  async updateOwnAvatar(userId: number, tenantId: number, file: { buffer: Buffer; filename?: string; mimetype?: string }, adminId?: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenant(userId, tenantId)
    if (!user) throw new NotFoundError('Usuário')
    if (file.buffer.length === 0) throw new ValidationError('Arquivo de avatar vazio')
    if (file.buffer.length > MAX_AVATAR_BYTES) throw new ValidationError('Avatar deve ter no máximo 512 KB')

    const mimeType = detectAvatarMime(file.buffer)
    if (!mimeType) throw new ValidationError('Avatar deve ser PNG, JPG ou WebP')
    const previousAvatar = await this.userRepo.findAvatarMetadata(userId, tenantId)

    const avatarPath = userAvatarPath(tenantId, userId)
    await mkdir(dirname(avatarPath), { recursive: true })
    await writeFile(avatarPath, file.buffer)

    const avatarUpdatedAt = new Date()
    await this.userRepo.updateAvatarMetadata(userId, mimeType, avatarUpdatedAt)
    if (adminId) {
      await this.userRepo.logAdminEvent({
        adminId,
        action: 'UPDATE_USER_AVATAR',
        targetType: 'User',
        targetId: userId,
        details: JSON.stringify({
          mimeType,
          sizeBytes: file.buffer.length,
          replacedExistingAvatar: Boolean(previousAvatar?.avatarUpdatedAt),
        }),
      }).catch(() => { /* best-effort */ })
    }
    const updated = await this.userRepo.findByIdInTenant(userId, tenantId)
    if (!updated) throw new NotFoundError('Usuário')
    return toPublic(
      { ...updated, avatarUpdatedAt } as User,
      await this.userRepo.findGroupIdsByUser(userId),
      await this.userRepo.canViewLiveSessions(userId),
    )
  }

  async removeOwnAvatar(userId: number, tenantId: number, adminId?: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenant(userId, tenantId)
    if (!user) throw new NotFoundError('Usuário')
    const previousAvatar = await this.userRepo.findAvatarMetadata(userId, tenantId)

    await unlink(userAvatarPath(tenantId, userId)).catch(() => undefined)
    await this.userRepo.clearAvatarMetadata(userId)
    if (adminId) {
      await this.userRepo.logAdminEvent({
        adminId,
        action: 'REMOVE_USER_AVATAR',
        targetType: 'User',
        targetId: userId,
        details: JSON.stringify({
          hadAvatar: Boolean(previousAvatar?.avatarUpdatedAt),
          previousMimeType: previousAvatar?.mimeType ?? null,
        }),
      }).catch(() => { /* best-effort */ })
    }
    const updated = await this.userRepo.findByIdInTenant(userId, tenantId)
    if (!updated) throw new NotFoundError('Usuário')
    return toPublic(
      { ...updated, avatarUpdatedAt: null } as User,
      await this.userRepo.findGroupIdsByUser(userId),
      await this.userRepo.canViewLiveSessions(userId),
    )
  }

  async getAvatar(userId: number, tenantId: number): Promise<{ buffer: Buffer; mimeType: string; updatedAt: Date }> {
    const meta = await this.userRepo.findAvatarMetadata(userId, tenantId)
    if (!meta?.mimeType || !meta.avatarUpdatedAt) throw new NotFoundError('Avatar')
    const buffer = await readFile(userAvatarPath(tenantId, userId)).catch(() => null)
    if (!buffer) throw new NotFoundError('Avatar')
    return { buffer, mimeType: meta.mimeType, updatedAt: meta.avatarUpdatedAt }
  }
}
