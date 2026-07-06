import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
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
import type { UserRepository, UserFilters } from './user.repository.js'
import type { WebhookService } from '../webhooks/webhook.service.js'

const BCRYPT_ROUNDS = 12

function toPublic(user: User, groupIds: number[] = [], canViewLiveSessions = false): UserPublic {
  return {
    id:             user.id,
    tenantId:       user.tenantId,
    name:           user.name,
    email:          user.email,
    role:           user.role === 'ADMIN' ? 'admin' : 'user',
    isPlatformAdmin:user.isPlatformAdmin,
    canManageHosts: user.canManageHosts,
    canViewLiveSessions,
    mfaEnabled:     user.mfaEnabled,
    active:         user.active,
    groupIds,
    deletedAt:      user.deletedAt ?? undefined,
    createdAt:      user.createdAt,
    updatedAt:      user.updatedAt,
  }
}

function mapRole(role: 'admin' | 'user'): 'ADMIN' | 'USER' {
  return role === 'admin' ? 'ADMIN' : 'USER'
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
    return { data: users.map((u) => toPublic(u, groupMap.get(u.id) ?? [], liveSessionPermissionMap.get(u.id) ?? false)), total, page, limit }
  }

  async getById(id: number, tenantId: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenantIncludingDeleted(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')
    const groupIds = await this.userRepo.findGroupIdsByUser(id)
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(id)
    return toPublic(user, groupIds, canViewLiveSessions)
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
    return toPublic({ ...user, deletedAt: null, active: true, licenseConsumed: true }, groupIds, canViewLiveSessions)
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
    const canViewLiveSessions = dto.canViewLiveSessions ?? await this.userRepo.canViewLiveSessions(id)
    return toPublic(updated, groupIds, canViewLiveSessions)
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
    return toPublic({ ...user, active, licenseConsumed: active }, [], canViewLiveSessions)
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
}
