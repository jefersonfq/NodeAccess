import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import type { CreateTenantDto, CreateTenantResult, TenantAdminBootstrapDto, TenantDashboardSummary, TenantPublic, UpdateTenantDto } from '@nodeaccess/shared'
import { ConflictError, LicenseLimitError, NotFoundError, ValidationError } from '../../shared/errors.js'
import type { TenantRepository, TenantWithLicense } from './tenant.repository.js'

const BCRYPT_ROUNDS = 12
const TENANT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED_TENANT_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'cdn',
  'dashboard',
  'default',
  'docs',
  'help',
  'login',
  'logout',
  'mail',
  'nodeaccess',
  'root',
  'static',
  'status',
  'support',
  'system',
  'www',
])

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

function assertValidSlug(slug: string): string {
  const normalized = normalizeSlug(slug)
  if (normalized.length < 2 || normalized.length > 63 || !TENANT_SLUG_REGEX.test(normalized)) {
    throw new ValidationError('Slug do tenant deve usar minúsculas, números e hífen apenas entre palavras')
  }
  if (RESERVED_TENANT_SLUGS.has(normalized)) {
    throw new ValidationError('Slug do tenant é reservado para rotas ou infraestrutura da plataforma')
  }
  return normalized
}

export class TenantService {
  constructor(private readonly tenantRepo: TenantRepository) {}

  async list(): Promise<TenantPublic[]> {
    const tenants = await this.tenantRepo.findAll()
    return Promise.all(tenants.map((tenant) => this.toPublic(tenant)))
  }

  async dashboard(): Promise<TenantDashboardSummary> {
    const from = new Date()
    from.setUTCHours(0, 0, 0, 0)
    from.setUTCDate(from.getUTCDate() - 6)

    const { tenantUsage, dailyActivity } = await this.tenantRepo.getDashboardSummary(from)
    const totals = tenantUsage.reduce((acc, tenant) => {
      const resources = tenant.hosts
        + tenant.snippets
        + tenant.hostLinks
        + tenant.associatedLinks
        + tenant.bastions
        + tenant.pemKeys
        + tenant.secrets
        + tenant.agents
      return {
        tenants: acc.tenants + 1,
        activeTenants: acc.activeTenants + (tenant.active ? 1 : 0),
        users: acc.users + tenant.users,
        activeUsers: acc.activeUsers + tenant.activeUsers,
        hosts: acc.hosts + tenant.hosts,
        resources: acc.resources + resources,
        loginsLast7Days: acc.loginsLast7Days + tenant.loginsLast7Days,
        sessionsLast7Days: acc.sessionsLast7Days + tenant.sessionsLast7Days,
        activeSessions: acc.activeSessions + tenant.activeSessions,
      }
    }, {
      tenants: 0,
      activeTenants: 0,
      users: 0,
      activeUsers: 0,
      hosts: 0,
      resources: 0,
      loginsLast7Days: 0,
      sessionsLast7Days: 0,
      activeSessions: 0,
    })

    return {
      totals,
      tenantUsage,
      topTenantsByActivity: [...tenantUsage]
        .sort((a, b) => (b.loginsLast7Days + b.sessionsLast7Days) - (a.loginsLast7Days + a.sessionsLast7Days))
        .slice(0, 5),
      dailyActivity,
    }
  }

  async create(dto: CreateTenantDto): Promise<CreateTenantResult> {
    const slug = assertValidSlug(dto.slug)
    const existingTenant = await this.tenantRepo.findBySlug(slug)
    if (existingTenant) throw new ConflictError('Slug de tenant já cadastrado')

    const existingUser = await this.tenantRepo.findUserByEmail(dto.firstAdmin.email)
    if (existingUser) throw new ConflictError('E-mail do primeiro admin já cadastrado')

    const firstAdminPassword = this.generateTemporaryPassword()
    const firstAdmin = {
      name: dto.firstAdmin.name,
      email: dto.firstAdmin.email,
      passwordHash: await bcrypt.hash(firstAdminPassword, BCRYPT_ROUNDS),
    }

    const tenant = await this.tenantRepo.create({
      name: dto.name,
      slug,
      active: dto.active ?? true,
      maxUsers: dto.maxUsers ?? 50,
      ...(firstAdmin ? { firstAdmin } : {}),
    })

    return {
      tenant: await this.toPublic(tenant),
      firstAdminTemporaryPassword: firstAdminPassword,
    }
  }

  async createAdmin(tenantId: number, dto: TenantAdminBootstrapDto): Promise<{ temporaryPassword: string }> {
    const tenant = await this.tenantRepo.findById(tenantId)
    if (!tenant) throw new NotFoundError('Tenant')

    const existingUser = await this.tenantRepo.findUserByEmail(dto.email)
    if (existingUser) throw new ConflictError('E-mail já cadastrado')

    const maxUsers = tenant.license?.maxUsers
    if (maxUsers !== null && maxUsers !== undefined) {
      const activeUsers = await this.tenantRepo.countActiveUsers(tenantId)
      if (activeUsers >= maxUsers) throw new LicenseLimitError()
    }

    const temporaryPassword = this.generateTemporaryPassword()
    await this.tenantRepo.createAdmin(tenantId, {
      name: dto.name,
      email: dto.email,
      passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
    })

    return { temporaryPassword }
  }

  async update(id: number, dto: UpdateTenantDto): Promise<TenantPublic> {
    const tenant = await this.tenantRepo.findById(id)
    if (!tenant) throw new NotFoundError('Tenant')

    const slug = dto.slug !== undefined ? assertValidSlug(dto.slug) : undefined

    if (slug !== undefined && slug !== tenant.slug) {
      const existingTenant = await this.tenantRepo.findBySlug(slug)
      if (existingTenant) throw new ConflictError('Slug de tenant já cadastrado')
    }

    const updated = await this.tenantRepo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(slug !== undefined && { slug }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.maxUsers !== undefined && { maxUsers: dto.maxUsers }),
    })
    return this.toPublic(updated)
  }

  async delete(id: number): Promise<void> {
    const tenant = await this.tenantRepo.findById(id)
    if (!tenant) throw new NotFoundError('Tenant')

    const counts = await this.tenantRepo.countDeleteBlockers(id)
    const blockers = Object.entries(counts)
      .filter(([key, count]) => {
        if (key === 'users') return count > 1
        return count > 0
      })
      .map(([key, count]) => `${key}: ${count}`)

    if (blockers.length > 0) {
      throw new ConflictError(`Tenant possui dados vinculados e nao pode ser excluido: ${blockers.join(', ')}`)
    }

    await this.tenantRepo.deleteBootstrapTenant(id)
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

  private generateTemporaryPassword(): string {
    return `A1${randomBytes(12).toString('base64url')}`
  }
}
