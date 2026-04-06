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

const BCRYPT_ROUNDS = 12

function toPublic(user: User, groupIds: number[] = []): UserPublic {
  return {
    id:             user.id,
    tenantId:       user.tenantId,
    name:           user.name,
    email:          user.email,
    role:           user.role === 'ADMIN' ? 'admin' : 'user',
    canManageHosts: user.canManageHosts,
    mfaEnabled:     user.mfaEnabled,
    active:         user.active,
    groupIds,
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
  },
  terminal: {
    preset: 'auto',
    fontSize: 14,
    fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
    theme: 'one-dark',
    rightClickMode: 'paste',
    multilinePasteMode: 'always',
    autoFullscreenOnConnect: false,
    snippetShortcutMode: 'default',
    hostSwitcherShortcutMode: 'default',
  },
  hosts: {
    displayMode: 'cards',
    favoriteHostIds: [],
    recentHostIds: [],
    quickAccessCollapsed: false,
    productivityCollapsed: false,
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
  })
}

export class UserService {
  constructor(private readonly userRepo: UserRepository) {}

  async list(
    tenantId: number,
    filters: UserFilters,
  ): Promise<Paginated<UserPublic>> {
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 20
    const { users, total } = await this.userRepo.findAll(tenantId, filters)
    return { data: users.map((u) => toPublic(u)), total, page, limit }
  }

  async getById(id: number, tenantId: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')
    const groupIds = await this.userRepo.findGroupIdsByUser(id)
    return toPublic(user, groupIds)
  }

  async create(
    dto: CreateUserDto,
    tenantId: number,
    adminId?: number,
  ): Promise<UserPublic & { temporaryPassword: string }> {
    // Verificar limite de licença
    const license = await this.userRepo.findLicenseByTenant(tenantId)
    if (license) {
      const activeCount = await this.userRepo.countActiveByTenant(tenantId)
      if (activeCount >= license.maxUsers) throw new LicenseLimitError()
    }

    // Verificar e-mail único no tenant
    const existing = await this.userRepo.findByEmail(dto.email, tenantId)
    if (existing) throw new ConflictError('E-mail já cadastrado neste tenant')

    // Gerar senha temporária
    const temporaryPassword = randomBytes(12).toString('base64url')
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS)

    // Validar política de senha (gerada internamente, mas checamos por segurança)
    const passwordRegex = new RegExp(env.PASSWORD_POLICY_REGEX)
    if (!passwordRegex.test(temporaryPassword)) {
      // Senhas base64url podem não satisfazer a política — garantir letras maiúsculas
      const safePassword = `A1${temporaryPassword}`
      const safeHash = await bcrypt.hash(safePassword, BCRYPT_ROUNDS)
      const user = await this.userRepo.create({
        name:           dto.name,
        email:          dto.email,
        passwordHash:   safeHash,
        role:           mapRole(dto.role),
        canManageHosts: dto.canManageHosts,
        tenantId,
        groupIds:       dto.groupIds,
      })
      return { ...toPublic(user), temporaryPassword: `A1${temporaryPassword}` }
    }

    const user = await this.userRepo.create({
      name:           dto.name,
      email:          dto.email,
      passwordHash,
      role:           mapRole(dto.role),
      canManageHosts: dto.canManageHosts,
      tenantId,
      groupIds:       dto.groupIds,
    })

    if (adminId) {
      await this.userRepo.logAdminEvent({ adminId, action: 'CREATE_USER', targetType: 'User', targetId: user.id }).catch(() => { /* best-effort */ })
    }
    return { ...toPublic(user), temporaryPassword }
  }

  async update(id: number, dto: UpdateUserDto, tenantId: number, adminId?: number): Promise<UserPublic> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user) throw new NotFoundError('Usuário')

    const updated = await this.userRepo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.role !== undefined && { role: mapRole(dto.role) }),
      ...(dto.canManageHosts !== undefined && { canManageHosts: dto.canManageHosts }),
      ...(dto.groupIds !== undefined && { groupIds: dto.groupIds }),
    })

    if (adminId) {
      await this.userRepo.logAdminEvent({ adminId, action: 'UPDATE_USER', targetType: 'User', targetId: id }).catch(() => { /* best-effort */ })
    }
    return toPublic(updated)
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
    return toPublic({ ...user, active, licenseConsumed: active })
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
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepo.findByIdInTenant(id, tenantId)
    if (!user?.passwordHash) throw new NotFoundError('Usuário')

    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) throw new ForbiddenError('Senha atual incorreta')

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
