import type { PrismaClient, Tenant } from '@prisma/client'
import { Prisma } from '@prisma/client'
import type { TenantDashboardDailyActivity, TenantDashboardTenant } from '@nodeaccess/shared'

export interface TenantWithLicense extends Tenant {
  license: { maxUsers: number } | null
  _count: { users: number }
}

export class TenantRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(): Promise<TenantWithLicense[]> {
    return this.db.tenant.findMany({
      include: {
        license: { select: { maxUsers: true } },
        _count:  { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async countActiveUsers(tenantId: number): Promise<number> {
    return this.db.user.count({ where: { tenantId, active: true, licenseConsumed: true } })
  }

  async getDashboardSummary(from: Date): Promise<{
    tenantUsage: TenantDashboardTenant[]
    dailyActivity: TenantDashboardDailyActivity[]
  }> {
    const tenants = await this.findAll()
    const loginRows = await this.db.$queryRaw<Array<{
      tenantId: number
      logins: bigint | number
      lastLoginAt: Date | null
    }>>(Prisma.sql`
      SELECT
        u.tenant_id AS tenantId,
        COUNT(*) AS logins,
        MAX(al.timestamp) AS lastLoginAt
      FROM auth_logs al
      INNER JOIN users u ON u.id = al.user_id
      WHERE al.success = true
        AND al.event_type IN ('LOGIN', 'SSO_LOGIN')
        AND al.timestamp >= ${from}
      GROUP BY u.tenant_id
    `)
    const sessionRows = await this.db.$queryRaw<Array<{
      tenantId: number
      sessions: bigint | number
    }>>(Prisma.sql`
      SELECT
        h.tenant_id AS tenantId,
        COUNT(*) AS sessions
      FROM sessions s
      INNER JOIN hosts h ON h.id = s.host_id
      WHERE s.started_at >= ${from}
      GROUP BY h.tenant_id
    `)
    const dailyLoginRows = await this.db.$queryRaw<Array<{
      date: string | Date
      logins: bigint | number
    }>>(Prisma.sql`
      SELECT
        DATE(al.timestamp) AS date,
        COUNT(*) AS logins
      FROM auth_logs al
      INNER JOIN users u ON u.id = al.user_id
      WHERE al.success = true
        AND al.event_type IN ('LOGIN', 'SSO_LOGIN')
        AND al.timestamp >= ${from}
      GROUP BY DATE(al.timestamp)
      ORDER BY DATE(al.timestamp)
    `)
    const dailySessionRows = await this.db.$queryRaw<Array<{
      date: string | Date
      sessions: bigint | number
    }>>(Prisma.sql`
      SELECT
        DATE(s.started_at) AS date,
        COUNT(*) AS sessions
      FROM sessions s
      INNER JOIN hosts h ON h.id = s.host_id
      WHERE s.started_at >= ${from}
      GROUP BY DATE(s.started_at)
      ORDER BY DATE(s.started_at)
    `)

    const loginMap = new Map(loginRows.map((row) => [row.tenantId, {
      logins: Number(row.logins),
      lastLoginAt: row.lastLoginAt,
    }]))
    const sessionMap = new Map(sessionRows.map((row) => [row.tenantId, Number(row.sessions)]))

    const tenantUsage = await Promise.all(tenants.map(async (tenant) => {
      const [
        activeUsers,
        hosts,
        snippets,
        hostLinks,
        associatedLinks,
        bastions,
        pemKeys,
        secrets,
        agents,
        activeSessions,
      ] = await Promise.all([
        this.countActiveUsers(tenant.id),
        this.db.host.count({ where: { tenantId: tenant.id, deletedAt: null } }),
        this.db.snippet.count({ where: { tenantId: tenant.id } }),
        this.db.hostLink.count({ where: { tenantId: tenant.id, revokedAt: null } }),
        this.db.hostAssociatedLink.count({ where: { tenantId: tenant.id, enabled: true } }),
        this.countBastionsByTenant(tenant.id),
        this.db.pemKey.count({ where: { createdBy: { tenantId: tenant.id } } }),
        this.db.secret.count({ where: { tenantId: tenant.id, revokedAt: null } }),
        this.db.agent.count({ where: { tenantId: tenant.id, deletedAt: null } }),
        this.db.session.count({ where: { active: true, host: { tenantId: tenant.id } } }),
      ])

      return {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        active: tenant.active,
        maxUsers: tenant.license?.maxUsers ?? null,
        users: tenant._count.users,
        activeUsers,
        hosts,
        snippets,
        hostLinks,
        associatedLinks,
        bastions,
        pemKeys,
        secrets,
        agents,
        sessionsLast7Days: sessionMap.get(tenant.id) ?? 0,
        activeSessions,
        loginsLast7Days: loginMap.get(tenant.id)?.logins ?? 0,
        lastLoginAt: loginMap.get(tenant.id)?.lastLoginAt ?? null,
      }
    }))

    return {
      tenantUsage,
      dailyActivity: this.mergeDailyActivity(from, dailyLoginRows, dailySessionRows),
    }
  }

  async findById(id: number): Promise<TenantWithLicense | null> {
    return this.db.tenant.findUnique({
      where: { id },
      include: {
        license: { select: { maxUsers: true } },
        _count:  { select: { users: true } },
      },
    })
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    return this.db.tenant.findUnique({ where: { slug } })
  }

  async findUserByEmail(email: string): Promise<{ id: number } | null> {
    return this.db.user.findFirst({ where: { email, deletedAt: null }, select: { id: true } })
  }

  async countUsers(tenantId: number): Promise<number> {
    return this.db.user.count({ where: { tenantId } })
  }

  async create(data: {
    name: string
    slug: string
    active: boolean
    maxUsers: number
    firstAdmin?: {
      name: string
      email: string
      passwordHash: string
    }
  }): Promise<TenantWithLicense> {
    return this.db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          active: data.active,
        },
      })

      await tx.license.create({
        data: {
          tenantId: tenant.id,
          maxUsers: data.maxUsers,
          active: true,
        },
      })

      if (data.firstAdmin) {
        await tx.user.create({
          data: {
            name: data.firstAdmin.name,
            email: data.firstAdmin.email,
            passwordHash: data.firstAdmin.passwordHash,
            role: 'ADMIN',
            tenantId: tenant.id,
            canManageHosts: true,
            forcePasswordChange: true,
          },
        })
      }

      return tx.tenant.findUniqueOrThrow({
        where: { id: tenant.id },
        include: {
          license: { select: { maxUsers: true } },
          _count:  { select: { users: true } },
        },
      })
    })
  }

  async createAdmin(tenantId: number, data: {
    name: string
    email: string
    passwordHash: string
  }): Promise<{ id: number }> {
    return this.db.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        role: 'ADMIN',
        tenantId,
        canManageHosts: true,
        forcePasswordChange: true,
        licenseConsumed: true,
        active: true,
      },
      select: { id: true },
    })
  }

  async update(id: number, data: { name?: string; slug?: string; active?: boolean; maxUsers?: number }): Promise<TenantWithLicense> {
    return this.db.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.slug !== undefined && { slug: data.slug }),
          ...(data.active !== undefined && { active: data.active }),
        },
      })

      if (data.maxUsers !== undefined) {
        await tx.license.upsert({
          where: { tenantId: id },
          create: { tenantId: id, maxUsers: data.maxUsers, active: true },
          update: { maxUsers: data.maxUsers },
        })
      }

      return tx.tenant.findUniqueOrThrow({
        where: { id },
        include: {
          license: { select: { maxUsers: true } },
          _count:  { select: { users: true } },
        },
      })
    })
  }

  async countDeleteBlockers(tenantId: number): Promise<Record<string, number>> {
    const [
      users,
      groups,
      hosts,
      folders,
      feedbacks,
      localAiKnowledgeDocuments,
      localAiProposedActions,
      tags,
      hostLinks,
      hostAssociatedLinks,
      bastions,
      pemKeys,
      sessions,
      sessionAudits,
      sharedSessions,
      diagnosticPlaybooks,
      diagnosticRuns,
      aiSshActionRuns,
      authLogs,
      adminLogs,
      integrations,
      sessionAuditPolicies,
      aiSshActionCommandPolicies,
      sessionCommandPolicyGroups,
      snippets,
      snippetGroups,
      secrets,
      agents,
      mcpTokens,
      mcpInteractiveSshSessions,
      webhookSubscriptions,
      emailConfigs,
      webhookEventOutbox,
      nativeSshGatewayConfigs,
    ] = await Promise.all([
      this.db.user.count({ where: { tenantId } }),
      this.db.group.count({ where: { tenantId } }),
      this.db.host.count({ where: { tenantId } }),
      this.db.folder.count({ where: { tenantId } }),
      this.db.feedback.count({ where: { tenantId } }),
      this.db.localAiKnowledgeDocument.count({ where: { tenantId } }),
      this.db.localAiProposedAction.count({ where: { tenantId } }),
      this.db.tag.count({ where: { tenantId } }),
      this.db.hostLink.count({ where: { tenantId } }),
      this.db.hostAssociatedLink.count({ where: { tenantId } }),
      this.countBastionsByTenant(tenantId),
      this.db.pemKey.count({ where: { createdBy: { tenantId } } }),
      this.db.session.count({ where: { OR: [{ user: { tenantId } }, { host: { tenantId } }] } }),
      this.db.sessionAudit.count({ where: { tenantId } }),
      this.db.sharedSession.count({ where: { tenantId } }),
      this.db.diagnosticPlaybook.count({ where: { tenantId } }),
      this.db.diagnosticRun.count({ where: { tenantId } }),
      this.db.aiSshActionRun.count({ where: { tenantId } }),
      this.db.authLog.count({ where: { user: { tenantId } } }),
      this.db.adminLog.count({ where: { admin: { tenantId } } }),
      this.db.integration.count({ where: { tenantId } }),
      this.db.sessionAuditPolicy.count({ where: { tenantId } }),
      this.db.aiSshActionCommandPolicy.count({ where: { tenantId } }),
      this.db.sessionCommandPolicyGroup.count({ where: { tenantId } }),
      this.db.snippet.count({ where: { tenantId } }),
      this.db.snippetGroup.count({ where: { tenantId } }),
      this.db.secret.count({ where: { tenantId } }),
      this.db.agent.count({ where: { tenantId } }),
      this.db.mcpToken.count({ where: { tenantId } }),
      this.db.mcpInteractiveSshSession.count({ where: { tenantId } }),
      this.db.webhookSubscription.count({ where: { tenantId } }),
      this.db.emailConfig.count({ where: { tenantId } }),
      this.db.webhookEventOutbox.count({ where: { tenantId } }),
      this.db.nativeSshGatewayConfig.count({ where: { tenantId } }),
    ])

    return {
      users,
      groups,
      hosts,
      folders,
      feedbacks,
      localAiKnowledgeDocuments,
      localAiProposedActions,
      tags,
      hostLinks,
      hostAssociatedLinks,
      bastions,
      pemKeys,
      sessions,
      sessionAudits,
      sharedSessions,
      diagnosticPlaybooks,
      diagnosticRuns,
      aiSshActionRuns,
      authLogs,
      adminLogs,
      integrations,
      sessionAuditPolicies,
      aiSshActionCommandPolicies,
      sessionCommandPolicyGroups,
      snippets,
      snippetGroups,
      secrets,
      agents,
      mcpTokens,
      mcpInteractiveSshSessions,
      webhookSubscriptions,
      emailConfigs,
      webhookEventOutbox,
      nativeSshGatewayConfigs,
    }
  }

  async deleteBootstrapTenant(tenantId: number): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.license.deleteMany({ where: { tenantId } })
      await tx.user.deleteMany({ where: { tenantId } })
      await tx.tenant.delete({ where: { id: tenantId } })
    })
  }

  private async countBastionsByTenant(tenantId: number): Promise<number> {
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) AS count
        FROM bastion_hosts
        WHERE tenant_id = ${tenantId}
      `,
    )
    return Number(rows[0]?.count ?? 0)
  }

  private mergeDailyActivity(
    from: Date,
    loginRows: Array<{ date: string | Date; logins: bigint | number }>,
    sessionRows: Array<{ date: string | Date; sessions: bigint | number }>,
  ): TenantDashboardDailyActivity[] {
    const logins = new Map(loginRows.map((row) => [this.formatDate(row.date), Number(row.logins)]))
    const sessions = new Map(sessionRows.map((row) => [this.formatDate(row.date), Number(row.sessions)]))
    const days: TenantDashboardDailyActivity[] = []
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(from)
      date.setUTCDate(from.getUTCDate() + i)
      const key = this.formatDate(date)
      days.push({ date: key, logins: logins.get(key) ?? 0, sessions: sessions.get(key) ?? 0 })
    }
    return days
  }

  private formatDate(value: string | Date): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    return String(value).slice(0, 10)
  }
}
