import { logger } from '../../config/logger.js'
import type { AppEventBus, InventoryAclChangedEvent, UserAclMembershipChangedEvent } from '../app-events/app-event.bus.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { SessionsRepository, ActiveInventoryAclSessionRow } from '../sessions/sessions.repository.js'
import type { SessionRuntimeControlBus } from '../sessions/session-runtime-control.bus.js'
import type { SshRepository } from '../ssh/ssh.repository.js'

interface ActiveTunnelAclCloser {
  closeRevokedByAclChange(tenantId: number): Promise<number>
}

export class InventoryAclSessionRevocationService {
  constructor(
    appEventBus: AppEventBus,
    private readonly sessionsRepo: SessionsRepository,
    private readonly sshRepo: SshRepository,
    private readonly runtimeControlBus: SessionRuntimeControlBus,
    private readonly logRepo?: LogRepository,
    private readonly activeTunnelCloser?: ActiveTunnelAclCloser,
  ) {
    appEventBus.onEvent((event) => {
      if (event.type === 'inventory_acl_changed') return this.handleAclChanged(event)
      if (event.type === 'user_acl_membership_changed') return this.handleUserAclMembershipChanged(event)
    })
  }

  private async handleAclChanged(event: InventoryAclChangedEvent): Promise<void> {
    const sessions = await this.sessionsRepo.findActiveAuthenticatedByInventoryNode(
      event.tenantId,
      event.inventoryNodeId,
    )

    const revoked = sessions.length > 0
      ? await this.findSessionsWithoutConnect(event.tenantId, sessions)
      : []

    const results = revoked.length > 0
      ? await Promise.allSettled(revoked.map(async (session) => {
          const result = await this.runtimeControlBus.closeSession(session.id, undefined, 'acl_revoked')
          await this.auditRevocation(event, session, result.closed, result.handledByRuntime)
          return result
        }))
      : []

    const closed = results.filter((result) => result.status === 'fulfilled' && result.value.closed).length
    const closedTunnels = await this.activeTunnelCloser?.closeRevokedByAclChange(event.tenantId).catch((err) => {
      logger.warn({ err, tenantId: event.tenantId, inventoryNodeId: event.inventoryNodeId }, 'Falha ao revalidar túneis ativos após mudança de ACL')
      return 0
    }) ?? 0
    if (revoked.length === 0 && closedTunnels === 0) return

    logger.info({
      event: 'inventory_acl.sessions_revoked',
      tenantId: event.tenantId,
      inventoryNodeId: event.inventoryNodeId,
      affectedSessions: sessions.length,
      revokedSessions: revoked.length,
      closedSessions: closed,
      closedTunnels,
      action: event.action,
      principalType: event.principalType,
      principalId: event.principalId,
    }, 'active sessions revalidated after inventory ACL change')
  }

  private async handleUserAclMembershipChanged(event: UserAclMembershipChangedEvent): Promise<void> {
    const sessions = await this.sessionsRepo.findActiveAuthenticatedByUser(
      event.tenantId,
      event.userId,
    )

    const revoked = sessions.length > 0
      ? await this.findSessionsWithoutConnect(event.tenantId, sessions)
      : []

    const results = revoked.length > 0
      ? await Promise.allSettled(revoked.map(async (session) => {
          const result = await this.runtimeControlBus.closeSession(session.id, undefined, 'acl_revoked')
          await this.auditMembershipRevocation(event, session, result.closed, result.handledByRuntime)
          return result
        }))
      : []

    const closed = results.filter((result) => result.status === 'fulfilled' && result.value.closed).length
    const closedTunnels = await this.activeTunnelCloser?.closeRevokedByAclChange(event.tenantId).catch((err) => {
      logger.warn({ err, tenantId: event.tenantId, userId: event.userId }, 'Falha ao revalidar túneis ativos após mudança de grupos do usuário')
      return 0
    }) ?? 0
    if (revoked.length === 0 && closedTunnels === 0) return

    logger.info({
      event: 'inventory_acl.user_membership_sessions_revoked',
      tenantId: event.tenantId,
      userId: event.userId,
      affectedSessions: sessions.length,
      revokedSessions: revoked.length,
      closedSessions: closed,
      closedTunnels,
      previousGroupIds: event.previousGroupIds,
      nextGroupIds: event.nextGroupIds,
    }, 'active sessions revalidated after user ACL membership change')
  }

  private async findSessionsWithoutConnect(
    tenantId: number,
    sessions: ActiveInventoryAclSessionRow[],
  ): Promise<ActiveInventoryAclSessionRow[]> {
    const revoked: ActiveInventoryAclSessionRow[] = []
    const groups = new Map<string, ActiveInventoryAclSessionRow[]>()

    for (const session of sessions) {
      const key = `${session.userRole}:${session.userId}`
      const current = groups.get(key) ?? []
      current.push(session)
      groups.set(key, current)
    }

    for (const group of groups.values()) {
      const first = group[0]
      if (!first) continue
      const allowedHostIds = await this.sshRepo.findHostIdsWithEffectivePermission(
        group.map((session) => session.hostId),
        tenantId,
        first.userId,
        'connect',
        first.userRole,
      )
      revoked.push(...group.filter((session) => !allowedHostIds.has(session.hostId)))
    }

    return revoked
  }

  private async auditRevocation(
    event: InventoryAclChangedEvent,
    session: ActiveInventoryAclSessionRow,
    closed: boolean,
    handledByRuntime: boolean,
  ): Promise<void> {
    await this.logRepo?.logAdminEvent({
      adminId: event.actorId,
      action: 'INVENTORY_ACL_SESSION_REVOKED',
      targetType: 'Session',
      targetId: session.id,
      details: JSON.stringify({
        tenantId: event.tenantId,
        inventoryNodeId: event.inventoryNodeId,
        hostId: session.hostId,
        userId: session.userId,
        principalType: event.principalType,
        principalId: event.principalId,
        aclAction: event.action,
        closed,
        handledByRuntime,
      }),
    }).catch(() => { /* best-effort */ })
  }

  private async auditMembershipRevocation(
    event: UserAclMembershipChangedEvent,
    session: ActiveInventoryAclSessionRow,
    closed: boolean,
    handledByRuntime: boolean,
  ): Promise<void> {
    await this.logRepo?.logAdminEvent({
      adminId: event.actorId,
      action: 'USER_ACL_MEMBERSHIP_SESSION_REVOKED',
      targetType: 'Session',
      targetId: session.id,
      details: JSON.stringify({
        tenantId: event.tenantId,
        userId: event.userId,
        hostId: session.hostId,
        previousGroupIds: event.previousGroupIds,
        nextGroupIds: event.nextGroupIds,
        closed,
        handledByRuntime,
      }),
    }).catch(() => { /* best-effort */ })
  }
}
