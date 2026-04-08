import { randomBytes, createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import { agentRegistry } from './agent.registry.js'

function generateToken(): string {
  return `na_agent_${randomBytes(32).toString('hex')}`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class AgentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly licenseEntitlementService: LicenseEntitlementService,
  ) {}

  // ── Listar agentes do usuário ────────────────────────────────────────────────

  async list(userId: number, tenantId: number) {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const agents = await this.db.agent.findMany({
      where: { tenantId, createdById: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, active: true,
        lastSeenAt: true, createdAt: true,
      },
    })
    return agents.map(a => ({
      ...a,
      online: agentRegistry.isOnline(a.id),
    }))
  }

  // ── Criar agente + retornar token em plaintext (única vez) ──────────────────

  async create(userId: number, tenantId: number, name: string): Promise<{ agent: object; token: string }> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const token = generateToken()
    const agent = await this.db.agent.create({
      data: {
        tenantId,
        createdById: userId,
        name,
        tokenHash: hashToken(token),
      },
      select: { id: true, name: true, createdAt: true },
    })
    return { agent, token }
  }

  // ── Revogar / desativar ──────────────────────────────────────────────────────

  async revoke(id: number, userId: number, tenantId: number): Promise<void> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const agent = await this.db.agent.findFirst({
      where: { id, tenantId },
      select: { id: true, createdById: true },
    })
    if (!agent) throw new AppError('Agente não encontrado', 404, 'AGENT_NOT_FOUND')
    if (agent.createdById !== userId) throw new AppError('Sem permissão', 403, 'AGENT_FORBIDDEN')
    await this.db.agent.update({ where: { id: agent.id }, data: { active: false } })
  }

  // ── Autenticar agente pelo token (usado no WebSocket gateway) ───────────────

  async authenticate(rawToken: string): Promise<{ id: number; tenantId: number; createdById: number; name: string } | null> {
    const hash  = hashToken(rawToken)
    const agent = await this.db.agent.findFirst({
      where: { tokenHash: hash, active: true },
      select: { id: true, tenantId: true, createdById: true, name: true },
    })
    return agent
  }

  // ── Atualizar lastSeenAt ─────────────────────────────────────────────────────

  async touch(id: number): Promise<void> {
    await this.db.agent.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => { /* ignore */ })
  }
}
