/**
 * NA-0187 — tenant admin view of login sessions: who is online, from which IP, and disconnect one session
 * (refresh token removed; the next request of that session is refused) or all of them (sessionVersion bump,
 * which also closes terminals and graphical sessions).
 */
import type { AppEventBus } from '../app-events/app-event.bus.js'
import type { LoginSessionRegistry, LoginSessionView } from '../auth/login-session.registry.js'
import { ConflictError, NotFoundError } from '../../shared/errors.js'
import type { UserRepository } from './user.repository.js'

type Users = Pick<UserRepository, 'findByIdInTenant' | 'findSessionVersion' | 'incrementSessionVersion' | 'logAdminEvent'>
export class UserLoginSessionsService {
  constructor(private readonly users: Users, private readonly registry: LoginSessionRegistry, private readonly appEventBus?: AppEventBus) {}

  private async user(tenantId: number, userId: number): Promise<void> {
    const user = await this.users.findByIdInTenant(userId, tenantId)
    if (!user || user.deletedAt) throw new NotFoundError('Usuário')
  }
  online(tenantId: number): Promise<Array<{ userId: number; sessions: number; lastSeenAt: number }>> {
    return this.registry.online(tenantId)
  }
  async list(tenantId: number, userId: number, currentSid?: string): Promise<LoginSessionView[]> {
    await this.user(tenantId, userId)
    return this.registry.list(tenantId, userId, currentSid)
  }
  async revoke(tenantId: number, adminId: number, userId: number, ref: string, currentSid?: string): Promise<void> {
    await this.user(tenantId, userId)
    const result = await this.registry.revoke(tenantId, userId, ref, currentSid)
    if (result.state === 'missing') throw new NotFoundError('Sessão')
    if (result.state === 'current') throw new ConflictError('Esta é a sua sessão atual; use Sair')
    const { ip, lastIp, authMethod } = result.record
    await this.users.logAdminEvent({ adminId, action: 'LOGIN_SESSION_REVOKED', targetType: 'User', targetId: userId,
      details: JSON.stringify({ ip, lastIp, authMethod }) }).catch(() => { /* best-effort */ })
  }
  async revokeAll(tenantId: number, adminId: number, userId: number): Promise<void> {
    if (userId === adminId) throw new ConflictError('Use Sair de todos os dispositivos no seu perfil')
    await this.user(tenantId, userId)
    const current = await this.users.findSessionVersion(userId, tenantId)
    if (current === null) throw new NotFoundError('Usuário')
    const sessionVersion = await this.users.incrementSessionVersion(userId, tenantId, current)
    if (sessionVersion === null) throw new ConflictError('Sessões alteradas ao mesmo tempo; tente de novo')
    await this.appEventBus?.publish({ type: 'user_sessions_revoked', tenantId, userId, sessionVersion, reason: 'logout_all', changedAt: new Date().toISOString() })
    await this.users.logAdminEvent({ adminId, action: 'LOGIN_SESSIONS_REVOKED_ALL', targetType: 'User', targetId: userId }).catch(() => { /* best-effort */ })
  }
}
