import type { AccessMapOverview, Paginated } from '@nodeaccess/shared'
import type { SessionsRepository, SessionFilters } from './sessions.repository.js'
import { getSessionStaleBefore } from './session-liveness.js'
import type { SshSessionRuntimeRegistry } from '../ssh/ssh-session-runtime.registry.js'
import type { GraphicalSessionRuntimeRegistry } from '../graphical/graphical-session-runtime.registry.js'
import type { SessionRuntimeControlBus } from './session-runtime-control.bus.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { AppEventBus } from '../app-events/app-event.bus.js'
import { avatarUrlFor } from '../users/avatar-url.js'

type AccessMapHostEntry = {
  host: {
    id: number
    tenantId: number
    name: string
    ip: string
    port: number
    accessProtocol: string
    scope: string
    groupName: string | null
  }
  activeSessions: number
  uniqueUsers: number
  oldestStartedAt: Date
  lastStartedAt: Date
  lastSeenAt: Date
  sessions: Array<{
    id: number
    user: { id: number; name: string; email: string; avatarUrl: string | null; avatarVersion: string | null }
    startedAt: Date
    lastSeenAt: Date
    durationSeconds: number
    connectionMethod: string
    accessType: string
    clientIp: string | null
    agentRemoteIp: string | null
    agentNameSnapshot: string | null
  }>
}

export interface SessionPublic {
  id:              number
  user:            { id: number; name: string; email: string }
  host:            { id: number; name: string; ip: string; deleted: boolean; deletedAt: Date | null }
  startedAt:       Date
  endedAt:         Date | null
  durationSeconds: number | null
  active:          boolean
  requestedConnectionMode: string | null
  connectionMethod: string
  agentId: number | null
  agentNameSnapshot: string | null
  agentSource: string | null
  clientIp: string | null
  userAgent: string | null
  accessType: string
  jitLinkId: number | null
  jitGuestName: string | null
  agentRemoteIp: string | null
  endedReason: string | null
  errorCode: string | null
  errorMessage: string | null
}

function toPublic(row: Awaited<ReturnType<SessionsRepository['findAll']>>['sessions'][number]): SessionPublic {
  const durationSeconds =
    row.endedAt
      ? Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000)
      : null

  return {
    id:              row.id,
    user:            row.user,
    host:            row.host,
    startedAt:       row.startedAt,
    endedAt:         row.endedAt,
    durationSeconds,
    active:          row.active,
    requestedConnectionMode: row.requestedConnectionMode,
    connectionMethod: row.connectionMethod,
    agentId: row.agentId,
    agentNameSnapshot: row.agentNameSnapshot,
    agentSource: row.agentSource,
    clientIp: row.clientIp,
    userAgent: row.userAgent,
    accessType: row.accessType,
    jitLinkId: row.jitLinkId,
    jitGuestName: row.jitGuestName,
    agentRemoteIp: row.agentRemoteIp,
    endedReason: row.endedReason,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  }
}

export class SessionsService {
  private readonly accessMapCache = new Map<string, { expiresAt: number; data: AccessMapOverview }>()

  constructor(
    private readonly repo: SessionsRepository,
    private readonly sshRuntimeRegistry?: SshSessionRuntimeRegistry,
    private readonly graphicalRuntimeRegistry?: GraphicalSessionRuntimeRegistry,
    private readonly runtimeControlBus?: SessionRuntimeControlBus,
    private readonly sshRepo?: SshRepository,
    appEventBus?: AppEventBus,
  ) {
    appEventBus?.onEvent((event) => {
      if (
        event.type === 'inventory_acl_changed'
        || event.type === 'user_acl_membership_changed'
        || event.type === 'session_presence_changed'
      ) {
        this.clearAccessMapCache()
      }
    })
  }

  async list(tenantId: number, filters: SessionFilters): Promise<Paginated<SessionPublic>> {
    await this.cleanupStaleActive()
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 20
    const { sessions, total } = await this.repo.findAll(tenantId, filters)
    return { data: sessions.map(toPublic), total, page, limit }
  }

  /** Encerra todas as sessões ativas globalmente (startup do gateway). */
  async cleanupAllGhosts(): Promise<number> {
    return this.repo.endAllActive()
  }

  async cleanupStaleActive(): Promise<number> {
    return this.repo.endStaleActive(getSessionStaleBefore())
  }

  /** Encerra todas as sessões ativas do tenant (cleanup manual via API). */
  async cleanupGhosts(tenantId: number): Promise<{ cleaned: number }> {
    const cleaned = await this.repo.endActiveSessions(tenantId)
    return { cleaned }
  }

  async closeActiveSession(tenantId: number, sessionId: number): Promise<{
    closed: boolean
    reason: 'closed' | 'not_found' | 'not_active' | 'not_in_runtime'
    connectionMethod: string | null
  }> {
    const session = await this.repo.findActiveRuntimeSession(tenantId, sessionId)
    if (!session) {
      return { closed: false, reason: 'not_found', connectionMethod: null }
    }
    if (!session.active) {
      return { closed: false, reason: 'not_active', connectionMethod: session.connectionMethod }
    }

    const isGraphical = session.connectionMethod === 'rdp_gateway_pending' || session.connectionMethod === 'vnc_gateway_pending'
    let closed = isGraphical
      ? this.graphicalRuntimeRegistry?.close(session.id, 'admin_closed') ?? false
      : this.sshRuntimeRegistry?.close(session.id, 'admin_closed') ?? false

    if (!closed && this.runtimeControlBus) {
      const result = await this.runtimeControlBus.closeSession(session.id)
      closed = result.closed
    }

    if (!closed) {
      await this.cleanupStaleActive()
      return { closed: false, reason: 'not_in_runtime', connectionMethod: session.connectionMethod }
    }

    this.clearAccessMapCache()
    return { closed: true, reason: 'closed', connectionMethod: session.connectionMethod }
  }

  clearAccessMapCache(): void {
    this.accessMapCache.clear()
  }

  async getAccessMap(
    tenantId: number,
    viewer: { userId: number; role: 'admin' | 'user' },
  ): Promise<AccessMapOverview> {
    await this.cleanupStaleActive()

    const cacheKey = `${tenantId}:${viewer.userId}:${viewer.role}`
    const cached = this.accessMapCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.data

    let rows = await this.repo.findActiveOverview(tenantId, {
      userId: viewer.userId,
      role: viewer.role === 'admin' ? 'ADMIN' : 'USER',
    })
    if (viewer.role !== 'admin' && this.sshRepo) {
      const visibleHostIds = await this.sshRepo.findHostIdsWithEffectivePermission(
        rows.map((row) => row.hostId),
        tenantId,
        viewer.userId,
        'view',
        'USER',
      )
      rows = rows.filter((row) => visibleHostIds.has(row.hostId))
    }

    const now = new Date()
    const users = new Set<number>()
    const hosts = new Map<number, AccessMapHostEntry>()

    for (const row of rows) {
      users.add(row.userId)
      const durationSeconds = Math.max(0, Math.round((now.getTime() - row.startedAt.getTime()) / 1000))
      let current = hosts.get(row.hostId)
      if (!current) {
        current = {
          host: {
            id: row.hostId,
            tenantId: row.hostTenantId,
            name: row.hostName,
            ip: row.hostIp,
            port: row.hostPort,
            accessProtocol: row.hostAccessProtocol,
            scope: row.hostScope,
            groupName: row.hostGroupName,
          },
          activeSessions: 0,
          uniqueUsers: 0,
          oldestStartedAt: row.startedAt,
          lastStartedAt: row.startedAt,
          lastSeenAt: row.lastSeenAt,
          sessions: [],
        }
        hosts.set(row.hostId, current)
      }
      current = hosts.get(row.hostId)!

      current.sessions.push({
        id: row.id,
        user: {
          id: row.userId,
          name: row.userName,
          email: row.userEmail,
          avatarUrl: avatarUrlFor(row.userId, row.userAvatarUpdatedAt),
          avatarVersion: row.userAvatarUpdatedAt ? String(row.userAvatarUpdatedAt.getTime()) : null,
        },
        startedAt: row.startedAt,
        lastSeenAt: row.lastSeenAt,
        durationSeconds,
        connectionMethod: row.connectionMethod,
        accessType: row.accessType,
        clientIp: row.clientIp,
        agentRemoteIp: row.agentRemoteIp,
        agentNameSnapshot: row.agentNameSnapshot,
      })
      current.activeSessions = current.sessions.length
      current.uniqueUsers = new Set(current.sessions.map((session) => session.user.id)).size
      if (row.startedAt < current.oldestStartedAt) current.oldestStartedAt = row.startedAt
      if (row.startedAt > current.lastStartedAt) current.lastStartedAt = row.startedAt
      if (row.lastSeenAt > current.lastSeenAt) current.lastSeenAt = row.lastSeenAt
    }

    const hostList = [...hosts.values()].sort((a, b) =>
      b.activeSessions - a.activeSessions
      || b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
      || a.host.name.localeCompare(b.host.name),
    )

    const data: AccessMapOverview = {
      generatedAt: now,
      refreshAfterSeconds: 5,
      totals: {
        activeSessions: rows.length,
        activeHosts: hostList.length,
        uniqueUsers: users.size,
        concurrentHosts: hostList.filter((host) => host.uniqueUsers > 1 || host.activeSessions > 1).length,
      },
      hosts: hostList as unknown as AccessMapOverview['hosts'],
    }

    this.accessMapCache.set(cacheKey, { expiresAt: Date.now() + 5_000, data })
    return data
  }
}
