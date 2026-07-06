import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import type { PlatformAdminRepository, PlatformAdminWithTenant } from './platform-admin.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js'

const BCRYPT_ROUNDS = 12
const DEFAULT_TENANT_SLUG = 'default'
const DEFAULT_TENANT_NAME = 'NodeAccess'

export interface PlatformAdminPublic {
  id: number
  tenantId: number
  tenantName: string
  tenantSlug: string
  name: string
  email: string
  active: boolean
  forcePasswordChange: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreatePlatformAdminDto {
  name?: string
  email: string
  tenantId?: number
  tenantSlug?: string
  tenantName?: string
  resetPassword?: boolean
}

export interface PlatformAdminResult {
  admin: PlatformAdminPublic
  temporaryPassword?: string
}

function toPublic(user: PlatformAdminWithTenant): PlatformAdminPublic {
  return {
    id: user.id,
    tenantId: user.tenantId,
    tenantName: user.tenant.name,
    tenantSlug: user.tenant.slug,
    name: user.name,
    email: user.email,
    active: user.active,
    forcePasswordChange: user.forcePasswordChange,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

function generateTemporaryPassword(): string {
  return `A1${randomBytes(12).toString('base64url')}`
}

export class PlatformAdminService {
  constructor(private readonly platformAdminRepo: PlatformAdminRepository) {}

  async list(): Promise<PlatformAdminPublic[]> {
    const admins = await this.platformAdminRepo.list()
    return admins.map(toPublic)
  }

  async createOrPromote(dto: CreatePlatformAdminDto, actorId: number): Promise<PlatformAdminResult> {
    const email = dto.email.trim().toLowerCase()
    if (!email) throw new ValidationError('E-mail é obrigatório')

    const tenant = dto.tenantId
      ? await this.platformAdminRepo.findTenantById(dto.tenantId)
      : await this.resolveTenant(dto)
    if (!tenant) throw new NotFoundError('Tenant')

    const existing = dto.tenantId
      ? await this.platformAdminRepo.findByEmailInTenant(email, tenant.id)
      : await this.platformAdminRepo.findByEmail(email)
    let temporaryPassword: string | undefined
    let passwordHash: string | undefined

    if (!existing || dto.resetPassword) {
      temporaryPassword = generateTemporaryPassword()
      passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS)
    }

    if (existing) {
      const admin = await this.platformAdminRepo.promote(existing.id, {
        ...(dto.name?.trim() && { name: dto.name.trim() }),
        ...(passwordHash && { passwordHash, forcePasswordChange: true }),
      })
      await this.log(actorId, existing.isPlatformAdmin ? 'UPDATE_PLATFORM_ADMIN' : 'PROMOTE_PLATFORM_ADMIN', admin.id, {
        email: admin.email,
        tenantId: admin.tenantId,
        tenantSlug: admin.tenant.slug,
        resetPassword: Boolean(passwordHash),
      })
      return { admin: toPublic(admin), ...(temporaryPassword && { temporaryPassword }) }
    }

    if (!dto.name?.trim()) {
      throw new ValidationError('Nome é obrigatório para criar um novo superadmin')
    }

    const admin = await this.platformAdminRepo.create({
      name: dto.name.trim(),
      email,
      passwordHash: passwordHash!,
      tenantId: tenant.id,
      forcePasswordChange: true,
    })
    await this.log(actorId, 'CREATE_PLATFORM_ADMIN', admin.id, { email: admin.email, tenantSlug: tenant.slug })
    return { admin: toPublic(admin), temporaryPassword: temporaryPassword! }
  }

  async promoteUser(id: number, actorId: number, resetPassword = false): Promise<PlatformAdminResult> {
    const existing = await this.platformAdminRepo.findById(id)
    if (!existing || existing.deletedAt) throw new NotFoundError('Usuário')

    let temporaryPassword: string | undefined
    let passwordHash: string | undefined
    if (resetPassword || !existing.passwordHash) {
      temporaryPassword = generateTemporaryPassword()
      passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS)
    }

    const admin = await this.platformAdminRepo.promote(existing.id, {
      ...(passwordHash && { passwordHash, forcePasswordChange: true }),
    })
    await this.log(actorId, existing.isPlatformAdmin ? 'UPDATE_PLATFORM_ADMIN' : 'PROMOTE_PLATFORM_ADMIN', admin.id, {
      email: admin.email,
      tenantId: admin.tenantId,
      tenantSlug: admin.tenant.slug,
      resetPassword: Boolean(passwordHash),
    })
    return { admin: toPublic(admin), ...(temporaryPassword && { temporaryPassword }) }
  }

  async resetPassword(id: number, actorId: number): Promise<PlatformAdminResult> {
    const existing = await this.platformAdminRepo.findById(id)
    if (!existing || !existing.isPlatformAdmin) throw new NotFoundError('Superadmin')

    const temporaryPassword = generateTemporaryPassword()
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS)
    const admin = await this.platformAdminRepo.resetPassword(id, passwordHash)
    await this.log(actorId, 'RESET_PLATFORM_ADMIN_PASSWORD', id, { email: admin.email })
    return { admin: toPublic(admin), temporaryPassword }
  }

  async revoke(id: number, actorId: number): Promise<void> {
    const existing = await this.platformAdminRepo.findById(id)
    if (!existing || !existing.isPlatformAdmin) throw new NotFoundError('Superadmin')

    if (existing.active) {
      const activePlatformAdmins = await this.platformAdminRepo.countActivePlatformAdmins()
      if (activePlatformAdmins <= 1) {
        throw new ConflictError('Não é possível remover o último superadmin ativo')
      }
    }

    await this.platformAdminRepo.revoke(id)
    await this.log(actorId, 'REVOKE_PLATFORM_ADMIN', id, { email: existing.email })
  }

  private async log(actorId: number, action: string, targetId: number, details: Record<string, unknown>): Promise<void> {
    await this.platformAdminRepo.logAdminEvent({
      adminId: actorId,
      action,
      targetType: 'User',
      targetId,
      details: JSON.stringify(details),
    }).catch(() => { /* best-effort */ })
  }

  private async resolveTenant(dto: CreatePlatformAdminDto) {
    const tenantSlug = normalizeSlug(dto.tenantSlug || DEFAULT_TENANT_SLUG)
    if (!tenantSlug) throw new ValidationError('Slug do tenant é obrigatório')

    const tenantName = dto.tenantName?.trim() || (tenantSlug === DEFAULT_TENANT_SLUG ? DEFAULT_TENANT_NAME : tenantSlug)
    return this.platformAdminRepo.ensureTenant(tenantSlug, tenantName)
  }
}
