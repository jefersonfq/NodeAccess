import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import type { CreateTenantDto, CreateTenantResult, TenantPublic, UpdateTenantDto } from '@nodeaccess/shared'
import { ConflictError, NotFoundError } from '../../shared/errors.js'
import type { TenantRepository, TenantWithLicense } from './tenant.repository.js'

const BCRYPT_ROUNDS = 12

export class TenantService {
  constructor(private readonly tenantRepo: TenantRepository) {}

  async list(): Promise<TenantPublic[]> {
    const tenants = await this.tenantRepo.findAll()
    return Promise.all(tenants.map((tenant) => this.toPublic(tenant)))
  }

  async create(dto: CreateTenantDto): Promise<CreateTenantResult> {
    const existingTenant = await this.tenantRepo.findBySlug(dto.slug)
    if (existingTenant) throw new ConflictError('Slug de tenant já cadastrado')

    let firstAdminPassword: string | undefined
    let firstAdmin: { name: string; email: string; passwordHash: string } | undefined

    if (dto.firstAdmin) {
      const existingUser = await this.tenantRepo.findUserByEmail(dto.firstAdmin.email)
      if (existingUser) throw new ConflictError('E-mail do primeiro admin já cadastrado')

      firstAdminPassword = `A1${randomBytes(12).toString('base64url')}`
      firstAdmin = {
        name: dto.firstAdmin.name,
        email: dto.firstAdmin.email,
        passwordHash: await bcrypt.hash(firstAdminPassword, BCRYPT_ROUNDS),
      }
    }

    const tenant = await this.tenantRepo.create({
      name: dto.name,
      slug: dto.slug,
      active: dto.active ?? true,
      maxUsers: dto.maxUsers ?? 50,
      ...(firstAdmin ? { firstAdmin } : {}),
    })

    return {
      tenant: await this.toPublic(tenant),
      ...(firstAdminPassword ? { firstAdminTemporaryPassword: firstAdminPassword } : {}),
    }
  }

  async update(id: number, dto: UpdateTenantDto): Promise<TenantPublic> {
    const tenant = await this.tenantRepo.findById(id)
    if (!tenant) throw new NotFoundError('Tenant')

    const updated = await this.tenantRepo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.maxUsers !== undefined && { maxUsers: dto.maxUsers }),
    })
    return this.toPublic(updated)
  }

  private async toPublic(tenant: TenantWithLicense): Promise<TenantPublic> {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      active: tenant.active,
      maxUsers: tenant.license?.maxUsers ?? null,
      activeUsers: await this.tenantRepo.countActiveUsers(tenant.id),
      totalUsers: tenant._count.users,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    }
  }
}
