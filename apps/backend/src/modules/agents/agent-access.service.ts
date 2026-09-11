import type { PrismaClient } from '@prisma/client'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { ActiveAgent } from './agent.registry.js'
import { AppError } from '../../shared/errors.js'

export interface AgentAccessRequest {
  userId: number
  tenantId: number
  hostId?: number
  purpose: 'connect' | 'connectivity_test'
}
export function agentAccessDenied(): AppError {
  return new AppError('Acesso pelo agente não autorizado pelas permissões atuais do usuário', 403, 'AGENT_ACCESS_DENIED')
}
export function isAgentAccessDenied(error: unknown): boolean {
  return error instanceof AppError && error.code === 'AGENT_ACCESS_DENIED'
}
export class AgentAccessService {
  constructor(private readonly db: PrismaClient, private readonly ssh: SshRepository) {}
  async authorize(agent: ActiveAgent, host: string, port: number, request: AgentAccessRequest): Promise<boolean> {
    if (agent.tenantId !== request.tenantId || (agent.agentMode === 'USER_BOUND' && agent.userId !== request.userId)) return false
    const user = await this.db.user.findFirst({ where: { id: request.userId, tenantId: request.tenantId, active: true, deletedAt: null, tenant: { active: true } }, select: { role: true, canManageHosts: true } })
    if (!user) return false
    const identity = await this.db.agent.findFirst({ where: { id: agent.agentId, tenantId: request.tenantId, active: true, deletedAt: null }, select: { createdById: true, agentMode: true, tokenHash: true } })
    if (!identity || identity.createdById !== agent.userId || identity.agentMode !== agent.agentMode || identity.tokenHash !== agent.credentialHash) return false
    if (request.hostId !== undefined) {
      const target = await this.db.host.findFirst({ where: { id: request.hostId, tenantId: request.tenantId, deletedAt: null }, select: { ip: true, port: true } })
      if (!target) return false
      if (target.ip === host && target.port === port) return this.ssh.hasEffectiveHostPermission(request.hostId, request.tenantId, request.userId, 'connect', user.role)
      // Editing an unsaved address is an administrative connectivity test, never a normal session.
      if (request.purpose !== 'connectivity_test') return false
      return this.ssh.hasEffectiveHostPermission(request.hostId, request.tenantId, request.userId, 'edit', user.role)
    }
    return request.purpose === 'connectivity_test' && (user.role === 'ADMIN' || user.canManageHosts)
  }
  async auditRevocation(agent: ActiveAgent, request: AgentAccessRequest, connectionId: string) {
    await this.db.adminLog.create({ data: { adminId: request.userId, action: 'agent_connection_access_revoked', targetType: 'agent', targetId: agent.agentId, details: JSON.stringify({ tenantId: request.tenantId, userId: request.userId, hostId: request.hostId, connectionId, purpose: request.purpose }) } })
  }
}
