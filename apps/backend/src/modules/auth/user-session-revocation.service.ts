import { isSessionRevocationCurrent } from './current-session.js'
import type { AppEventBus, UserSessionsRevokedEvent } from '../app-events/app-event.bus.js'
import type { SessionsRepository } from '../sessions/sessions.repository.js'
import type { SessionRuntimeControlBus } from '../sessions/session-runtime-control.bus.js'
import { logger } from '../../config/logger.js'

export interface ActiveUserResourceCloser {
  closeRevokedByUser(authTenantId: number, userId: number): Promise<number>
}

/** The persisted version denies new admissions; this event closes existing runtimes. */
export class UserSessionRevocationService {
  constructor(appEventBus: AppEventBus,
    private readonly sessionsRepo: SessionsRepository,
    private readonly runtimeControl: SessionRuntimeControlBus,
    private readonly resourceCloser?: ActiveUserResourceCloser,
  ) {
    appEventBus.onEvent(event => {
      if (event.type === 'user_sessions_revoked') return this.revoke(event)
    })
  }

  async revoke(event: UserSessionsRevokedEvent): Promise<void> {
    if (!await isSessionRevocationCurrent(event.tenantId, event.userId, event.sessionVersion)) return
    const sessions = await this.sessionsRepo.findActiveAuthenticatedByPrincipal(event.tenantId, event.userId)
    const results = await Promise.allSettled(sessions.map(session => this.runtimeControl.closeSession(session.id, undefined, 'session_revoked')))
    const confirmed = results.filter(result => result.status === 'fulfilled' && result.value.closed && result.value.handledByRuntime).length
    const resources = await this.resourceCloser?.closeRevokedByUser(event.tenantId, event.userId)
    if (confirmed !== sessions.length) {
      logger.warn({ tenantId: event.tenantId, userId: event.userId, requested: sessions.length, confirmed, reason: event.reason }, 'Encerramento de sessões revogadas não confirmado')
      return
    }
    logger.info({ tenantId: event.tenantId, userId: event.userId, confirmed, resources: resources ?? 0, reason: event.reason }, 'Sessões do usuário revogadas')
  }
}
