import type { PrismaClient, HostScope } from '@prisma/client'
import type { JwtPayload } from '../../shared/guards.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import type { LocalAiKnowledgeRepository } from './local-ai-knowledge.repository.js'

export class LocalAiToolsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly entitlements: LicenseEntitlementService,
    private readonly knowledgeRepository: LocalAiKnowledgeRepository,
  ) {}

  async getPlatformSnapshot(user: JwtPayload): Promise<{
    tenantName: string
    enabledModules: string[]
    visibleHosts: number
    activeSessions: number
  }> {
    const tenant = await this.db.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true },
    })

    const snapshot = await this.entitlements.getSnapshot(user.tenantId)
    const enabledModules = Object.entries(snapshot.featureEntitlements)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)

    const visibleHosts = await this.db.host.count({
      where: await this.buildHostVisibilityWhere(user),
    })

    const activeSessions = await this.db.session.count({
      where: {
        active: true,
        user: { tenantId: user.tenantId },
      },
    })

    return {
      tenantName: tenant?.name ?? `Tenant ${user.tenantId}`,
      enabledModules,
      visibleHosts,
      activeSessions,
    }
  }

  async searchHosts(user: JwtPayload, query: string, limit = 5): Promise<Array<{
    id: number
    name: string
    ip: string
    scope: HostScope
    groupName: string | null
    bastionName: string | null
  }>> {
    const search = query.trim()
    if (!search) return []

    const hosts = await this.db.host.findMany({
      where: {
        ...(await this.buildHostVisibilityWhere(user)),
        OR: [
          { name: { contains: search } },
          { ip: { contains: search } },
          { group: { name: { contains: search } } },
          { bastion: { name: { contains: search } } },
        ],
      },
      select: {
        id: true,
        name: true,
        ip: true,
        scope: true,
        group: { select: { name: true } },
        bastion: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: limit,
    })

    return hosts.map((host) => ({
      id: host.id,
      name: host.name,
      ip: host.ip,
      scope: host.scope,
      groupName: host.group?.name ?? null,
      bastionName: host.bastion?.name ?? null,
    }))
  }

  async listRecentSessions(user: JwtPayload, limit = 5): Promise<Array<{
    id: number
    hostName: string
    hostIp: string
    startedAt: Date
    active: boolean
  }>> {
    const rows = await this.db.session.findMany({
      where: user.role === 'admin'
        ? { user: { tenantId: user.tenantId } }
        : { userId: Number(user.sub) },
      select: {
        id: true,
        startedAt: true,
        active: true,
        host: {
          select: {
            name: true,
            ip: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    })

    return rows.map((row) => ({
      id: row.id,
      hostName: row.host.name,
      hostIp: row.host.ip,
      startedAt: row.startedAt,
      active: row.active,
    }))
  }

  async getHostSummary(user: JwtPayload, hostId: number): Promise<{
    id: number
    name: string
    ip: string
    port: number
    sshUser: string
    scope: HostScope
    connectionMode: string
    bastionName: string | null
    groupName: string | null
    recentSessions: Array<{
      id: number
      startedAt: Date
      active: boolean
      userName: string
    }>
  } | null> {
    const row = await this.db.host.findFirst({
      where: {
        id: hostId,
        ...(await this.buildHostVisibilityWhere(user)),
      },
      select: {
        id: true,
        name: true,
        ip: true,
        port: true,
        sshUser: true,
        scope: true,
        connectionMode: true,
        bastion: { select: { name: true } },
        group: { select: { name: true } },
      },
    })

    if (!row) return null

    const recentSessions = await this.db.session.findMany({
      where: {
        hostId: row.id,
        ...(user.role === 'admin'
          ? { user: { tenantId: user.tenantId } }
          : { userId: Number(user.sub) }),
      },
      select: {
        id: true,
        startedAt: true,
        active: true,
        user: { select: { name: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 3,
    })

    return {
      id: row.id,
      name: row.name,
      ip: row.ip,
      port: row.port,
      sshUser: row.sshUser,
      scope: row.scope,
      connectionMode: row.connectionMode,
      bastionName: row.bastion?.name ?? null,
      groupName: row.group?.name ?? null,
      recentSessions: recentSessions.map((session) => ({
        id: session.id,
        startedAt: session.startedAt,
        active: session.active,
        userName: session.user.name,
      })),
    }
  }

  async getSessionSummary(user: JwtPayload, sessionId: number): Promise<{
    id: number
    hostName: string
    hostIp: string
    startedAt: Date
    endedAt: Date | null
    active: boolean
    userName: string
  } | null> {
    const row = await this.db.session.findFirst({
      where: {
        id: sessionId,
        ...(user.role === 'admin'
          ? { user: { tenantId: user.tenantId } }
          : { userId: Number(user.sub) }),
      },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        active: true,
        user: { select: { name: true } },
        host: {
          select: {
            name: true,
            ip: true,
          },
        },
      },
    })

    if (!row) return null

    return {
      id: row.id,
      hostName: row.host.name,
      hostIp: row.host.ip,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      active: row.active,
      userName: row.user.name,
    }
  }

  async getGroupSummary(user: JwtPayload, groupName: string): Promise<{
    id: number
    name: string
    description: string | null
    bastionName: string | null
    visibleHosts: Array<{
      id: number
      name: string
      ip: string
      scope: HostScope
    }>
  } | null> {
    const search = groupName.trim()
    if (!search) return null

    const row = await this.db.group.findFirst({
      where: {
        tenantId: user.tenantId,
        name: { contains: search },
        ...(user.role === 'admin' ? {} : {
          users: { some: { userId: Number(user.sub) } },
        }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        bastion: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    })

    if (!row) return null

    const visibleHosts = await this.db.host.findMany({
      where: {
        ...(await this.buildHostVisibilityWhere(user)),
        groupId: row.id,
      },
      select: {
        id: true,
        name: true,
        ip: true,
        scope: true,
      },
      orderBy: { name: 'asc' },
      take: 5,
    })

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      bastionName: row.bastion?.name ?? null,
      visibleHosts,
    }
  }

  async getBastionSummary(user: JwtPayload, bastionName: string): Promise<{
    id: number
    name: string
    ip: string
    port: number
    sshUser: string
    visibleHosts: Array<{
      id: number
      name: string
      ip: string
      scope: HostScope
      groupName: string | null
    }>
    relatedGroups: string[]
  } | null> {
    const search = bastionName.trim()
    if (!search) return null

    const visibleHosts = await this.db.host.findMany({
      where: {
        ...(await this.buildHostVisibilityWhere(user)),
        bastion: {
          name: { contains: search },
        },
      },
      select: {
        id: true,
        name: true,
        ip: true,
        scope: true,
        group: { select: { name: true } },
        bastion: {
          select: {
            id: true,
            name: true,
            ip: true,
            port: true,
            sshUser: true,
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 5,
    })

    const bastion = visibleHosts[0]?.bastion
    if (!bastion) return null

    const relatedGroups = await this.db.group.findMany({
      where: {
        tenantId: user.tenantId,
        bastionId: bastion.id,
      },
      select: { name: true },
      orderBy: { name: 'asc' },
      take: 5,
    })

    return {
      id: bastion.id,
      name: bastion.name,
      ip: bastion.ip,
      port: bastion.port,
      sshUser: bastion.sshUser,
      visibleHosts: visibleHosts.map((host) => ({
        id: host.id,
        name: host.name,
        ip: host.ip,
        scope: host.scope,
        groupName: host.group?.name ?? null,
      })),
      relatedGroups: relatedGroups.map((group) => group.name),
    }
  }

  async searchSessionAudits(user: JwtPayload, query: string, limit = 3): Promise<Array<{
    sessionId: number
    hostName: string
    hostIp: string
    startedAt: Date
    status: string
    riskLevel: string | null
    summary: string | null
  }>> {
    const search = query.trim()
    if (!search) return []

    const rows = await this.db.sessionAudit.findMany({
      where: {
        tenantId: user.tenantId,
        ...(user.role === 'admin' ? {} : { userId: Number(user.sub) }),
        OR: [
          { hostNameSnapshot: { contains: search } },
          { hostIpSnapshot: { contains: search } },
          { ticketKey: { contains: search } },
          { aiSummaryText: { contains: search } },
        ],
      },
      select: {
        sessionId: true,
        hostNameSnapshot: true,
        hostIpSnapshot: true,
        startedAt: true,
        status: true,
        aiRiskLevel: true,
        aiSummaryText: true,
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    })

    return rows.map((row) => ({
      sessionId: row.sessionId,
      hostName: row.hostNameSnapshot,
      hostIp: row.hostIpSnapshot,
      startedAt: row.startedAt,
      status: row.status,
      riskLevel: row.aiRiskLevel,
      summary: row.aiSummaryText,
    }))
  }

  async getSessionAuditSummary(user: JwtPayload, sessionId: number): Promise<{
    sessionId: number
    hostName: string
    hostIp: string
    startedAt: Date
    endedAt: Date | null
    status: string
    riskLevel: string | null
    summary: string | null
  } | null> {
    const row = await this.db.sessionAudit.findFirst({
      where: {
        tenantId: user.tenantId,
        sessionId,
        ...(user.role === 'admin' ? {} : { userId: Number(user.sub) }),
      },
      select: {
        sessionId: true,
        hostNameSnapshot: true,
        hostIpSnapshot: true,
        startedAt: true,
        endedAt: true,
        status: true,
        aiRiskLevel: true,
        aiSummaryText: true,
      },
    })

    if (!row) return null

    return {
      sessionId: row.sessionId,
      hostName: row.hostNameSnapshot,
      hostIp: row.hostIpSnapshot,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      status: row.status,
      riskLevel: row.aiRiskLevel,
      summary: row.aiSummaryText,
    }
  }

  async getTicketAuditSummary(user: JwtPayload, ticketKey: string): Promise<{
    sessionId: number
    hostName: string
    hostIp: string
    startedAt: Date
    endedAt: Date | null
    status: string
    riskLevel: string | null
    summary: string | null
    ticketProvider: string | null
    ticketKey: string | null
  } | null> {
    const normalizedKey = ticketKey.trim().toUpperCase()
    if (!normalizedKey) return null

    const row = await this.db.sessionAudit.findFirst({
      where: {
        tenantId: user.tenantId,
        ticketKey: normalizedKey,
        ...(user.role === 'admin' ? {} : { userId: Number(user.sub) }),
      },
      select: {
        sessionId: true,
        hostNameSnapshot: true,
        hostIpSnapshot: true,
        startedAt: true,
        endedAt: true,
        status: true,
        aiRiskLevel: true,
        aiSummaryText: true,
        ticketProvider: true,
        ticketKey: true,
      },
      orderBy: { startedAt: 'desc' },
    })

    if (!row) return null

    return {
      sessionId: row.sessionId,
      hostName: row.hostNameSnapshot,
      hostIp: row.hostIpSnapshot,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      status: row.status,
      riskLevel: row.aiRiskLevel,
      summary: row.aiSummaryText,
      ticketProvider: row.ticketProvider,
      ticketKey: row.ticketKey,
    }
  }

  async searchKnowledgeBase(user: JwtPayload, query: string, limit = 3): Promise<Array<{
    id: number
    title: string
    sourceType: 'TEXT' | 'LINK' | 'FILE'
    referenceUrl: string | null
    excerpt: string | null
  }>> {
    return this.knowledgeRepository.searchReadyDocuments(user.tenantId, query, limit)
  }

  private async buildHostVisibilityWhere(user: JwtPayload) {
    if (user.role === 'admin') {
      return { tenantId: user.tenantId, deletedAt: null }
    }

    const groups = await this.db.userGroup.findMany({
      where: { userId: Number(user.sub) },
      select: { groupId: true },
    })

    return {
      tenantId: user.tenantId,
      deletedAt: null,
      OR: [
        { scope: 'PERSONAL' as const, ownerId: Number(user.sub) },
        { scope: 'TEAM' as const, groupId: { in: groups.map((group) => group.groupId) } },
        { scope: 'GLOBAL' as const },
      ],
    }
  }
}
