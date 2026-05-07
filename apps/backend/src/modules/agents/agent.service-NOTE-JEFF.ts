import { randomBytes, createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import { agentRegistry } from './agent.registry.js'

function generateToken(): string {
  return `na_agent_${randomBytes(32).toString('hex')}`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function agentSnapshot(agent: { id: number; name: string; agentMode: string; createdById: number }) {
  return JSON.stringify({
    agentId:   agent.id,
    agentName: agent.name,
    agentMode: agent.agentMode,
    createdBy: agent.createdById,
  })
}

export interface AgentRuntimeDiagnostics {
  version?:  string
  hostname?: string
  platform?: string
  arch?:     string
  remoteIp?: string
}

interface AgentDiagnosticRow {
  id: number
  lastAgentVersion: string | null
  lastAgentHostname: string | null
  lastAgentPlatform: string | null
  lastAgentArch: string | null
  lastAgentRemoteIp: string | null
  lastAgentConnectedAt: Date | null
  lastAgentDisconnectedAt: Date | null
  lastAgentDisconnectReason: string | null
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export class AgentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly licenseEntitlementService: LicenseEntitlementService,
  ) {}

  // ── Listar agentes — usuário vê os próprios; admin vê todos do tenant ─────────

  async list(userId: number, tenantId: number, isAdmin = false) {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const agents = await this.db.agent.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(isAdmin ? {} : { createdById: userId }),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, active: true, agentMode: true, isDefault: true,
        revokedAt: true, lastSeenAt: true, createdAt: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    })
    const agentIds = agents.map((agent) => agent.id)
    const diagnosticRows = agentIds.length
      ? await this.db.$queryRaw<AgentDiagnosticRow[]>(Prisma.sql`
          SELECT
            id,
            last_agent_version AS lastAgentVersion,
            last_agent_hostname AS lastAgentHostname,
            last_agent_platform AS lastAgentPlatform,
            last_agent_arch AS lastAgentArch,
            last_agent_remote_ip AS lastAgentRemoteIp,
            last_agent_connected_at AS lastAgentConnectedAt,
            last_agent_disconnected_at AS lastAgentDisconnectedAt,
            last_agent_disconnect_reason AS lastAgentDisconnectReason
          FROM agents
          WHERE id IN (${Prisma.join(agentIds)})
        `)
      : []
    const diagnosticsByAgentId = new Map(diagnosticRows.map((row) => [row.id, row]))
    return agents.map(a => {
      const runtime = agentRegistry.getActiveById(a.id)
      const offline = agentRegistry.getLastOfflineReason(a.id)
      const last = diagnosticsByAgentId.get(a.id)
      return {
        id:                a.id,
        name:              a.name,
        active:            a.active,
        agentMode:         a.agentMode,
        isDefault:         a.isDefault,
        revokedAt:         a.revokedAt?.toISOString() ?? null,
        lastSeenAt:        a.lastSeenAt?.toISOString() ?? null,
        createdAt:         a.createdAt.toISOString(),
        owner:             isAdmin ? { id: a.createdBy.id, name: a.createdBy.name, email: a.createdBy.email } : undefined,
        online:            runtime !== undefined,
        version:           runtime?.version  ?? last?.lastAgentVersion  ?? null,
        hostname:          runtime?.hostname ?? last?.lastAgentHostname ?? null,
        platform:          runtime?.platform ?? last?.lastAgentPlatform ?? null,
        arch:              runtime?.arch     ?? last?.lastAgentArch     ?? null,
        remoteIp:          runtime?.remoteIp ?? last?.lastAgentRemoteIp ?? null,
        connectedAt:       runtime?.connectedAt?.toISOString() ?? null,
        lastVersion:       last?.lastAgentVersion ?? null,
        lastHostname:      last?.lastAgentHostname ?? null,
        lastPlatform:      last?.lastAgentPlatform ?? null,
        lastArch:          last?.lastAgentArch ?? null,
        lastRemoteIp:      last?.lastAgentRemoteIp ?? null,
        lastConnectedAt:   toIso(last?.lastAgentConnectedAt ?? null),
        lastDisconnectedAt: toIso(last?.lastAgentDisconnectedAt ?? null),
        lastDisconnectReason: last?.lastAgentDisconnectReason ?? null,
        lastOfflineReason: offline?.reason ?? null,
        lastOfflineAt:     offline?.at.toISOString() ?? null,
      }
    })
  }

  // ── Criar agente + retornar token em plaintext (única vez) ──────────────────

  async create(userId: number, tenantId: number, name: string, agentMode: 'USER_BOUND' | 'SERVICE_BOUND' = 'USER_BOUND'): Promise<{ agent: object; token: string }> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const token = generateToken()
    const agent = await this.db.agent.create({
      data: { tenantId, createdById: userId, name, agentMode, tokenHash: hashToken(token) },
      select: { id: true, name: true, agentMode: true, createdAt: true },
    })
    await this.db.adminLog.create({
      data: {
        adminId:    userId,
        action:     'agent_created',
        targetType: 'agent',
        targetId:   agent.id,
        details:    agentSnapshot({ ...agent, createdById: userId }),
      },
    }).catch(() => { /* best-effort */ })
    await this.db.adminLog.create({
      data: {
        adminId:    userId,
        action:     'agent_token_issued',
        targetType: 'agent',
        targetId:   agent.id,
        details:    agentSnapshot({ ...agent, createdById: userId }),
      },
    }).catch(() => { /* best-effort */ })
    return { agent, token }
  }

  // ── Reativar agente revogado ─────────────────────────────────────────────────

  async reactivate(id: number, userId: number, tenantId: number, isAdmin = false): Promise<void> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const agent = await this.db.agent.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, agentMode: true, createdById: true },
    })
    if (!agent) throw new AppError('Agente não encontrado', 404, 'AGENT_NOT_FOUND')
    if (!isAdmin && agent.createdById !== userId) throw new AppError('Sem permissão', 403, 'AGENT_FORBIDDEN')
    await this.db.agent.update({
      where: { id: agent.id },
      data:  { active: true, revokedAt: null, revokedById: null },
    })
    await this.db.adminLog.create({
      data: {
        adminId:    userId,
        action:     'agent_reactivated',
        targetType: 'agent',
        targetId:   agent.id,
        details:    agentSnapshot({ ...agent, createdById: agent.createdById }),
      },
    }).catch(() => { /* best-effort */ })
  }

  // ── Revogar — bloqueia conexões, mantém cadastro ─────────────────────────────

  async revoke(id: number, userId: number, tenantId: number, isAdmin = false): Promise<void> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const agent = await this.db.agent.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, agentMode: true, createdById: true },
    })
    if (!agent) throw new AppError('Agente não encontrado', 404, 'AGENT_NOT_FOUND')
    if (!isAdmin && agent.createdById !== userId) throw new AppError('Sem permissão', 403, 'AGENT_FORBIDDEN')
    await this.db.agent.update({
      where: { id: agent.id },
      data:  { active: false, revokedAt: new Date(), revokedById: userId },
    })
    await this.db.adminLog.create({
      data: {
        adminId:    userId,
        action:     'agent_revoked',
        targetType: 'agent',
        targetId:   agent.id,
        details:    agentSnapshot({ ...agent, createdById: agent.createdById }),
      },
    }).catch(() => { /* best-effort */ })
  }

  // ── Excluir permanentemente (soft delete, preserva auditoria) ────────────────

  async permanentDelete(id: number, userId: number, tenantId: number, isAdmin = false): Promise<void> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const agent = await this.db.agent.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, agentMode: true, createdById: true },
    })
    if (!agent) throw new AppError('Agente não encontrado', 404, 'AGENT_NOT_FOUND')
    if (!isAdmin && agent.createdById !== userId) throw new AppError('Sem permissão', 403, 'AGENT_FORBIDDEN')
    await this.db.agent.update({
      where: { id: agent.id },
      data:  { deletedAt: new Date(), deletedById: userId, active: false },
    })
    await this.db.adminLog.create({
      data: {
        adminId:    userId,
        action:     'agent_deleted',
        targetType: 'agent',
        targetId:   agent.id,
        details:    agentSnapshot({ ...agent, createdById: agent.createdById }),
      },
    }).catch(() => { /* best-effort */ })
  }

  // ── Marcar agente de serviço como padrão do tenant ───────────────────────────

  async setDefault(id: number, userId: number, tenantId: number, _isAdmin = false): Promise<void> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const agent = await this.db.agent.findFirst({
      where: { id, tenantId, deletedAt: null, agentMode: 'SERVICE_BOUND' },
      select: { id: true, name: true, agentMode: true, createdById: true },
    })
    if (!agent) throw new AppError('Agente não encontrado ou não é SERVICE_BOUND', 404, 'AGENT_NOT_FOUND')
    // Desmarca outros defaults do tenant
    await this.db.agent.updateMany({
      where: { tenantId, isDefault: true },
      data:  { isDefault: false },
    })
    await this.db.agent.update({
      where: { id: agent.id },
      data:  { isDefault: true },
    })
  }

  // ── Autenticar agente pelo token (usado no WebSocket gateway) ───────────────

  async authenticate(rawToken: string): Promise<{ id: number; tenantId: number; createdById: number; name: string; agentMode: 'USER_BOUND' | 'SERVICE_BOUND'; isDefault: boolean } | null> {
    const hash  = hashToken(rawToken)
    const agent = await this.db.agent.findFirst({
      where: { tokenHash: hash, active: true, deletedAt: null },
      select: { id: true, tenantId: true, createdById: true, name: true, agentMode: true, isDefault: true },
    })
    return agent
  }

  // ── Atualizar lastSeenAt ─────────────────────────────────────────────────────

  async touch(id: number): Promise<void> {
    await this.db.agent.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => { /* ignore */ })
  }

  async markConnected(id: number, diagnostics: AgentRuntimeDiagnostics): Promise<void> {
    const now = new Date()
    await this.db.$executeRaw`
      UPDATE agents
      SET
        last_seen_at = ${now},
        last_agent_connected_at = ${now},
        last_agent_disconnected_at = NULL,
        last_agent_disconnect_reason = NULL,
        last_agent_version = COALESCE(${diagnostics.version ?? null}, last_agent_version),
        last_agent_hostname = COALESCE(${diagnostics.hostname ?? null}, last_agent_hostname),
        last_agent_platform = COALESCE(${diagnostics.platform ?? null}, last_agent_platform),
        last_agent_arch = COALESCE(${diagnostics.arch ?? null}, last_agent_arch),
        last_agent_remote_ip = COALESCE(${diagnostics.remoteIp ?? null}, last_agent_remote_ip)
      WHERE id = ${id}
    `.catch(() => { /* ignore */ })
  }

  async markDisconnected(id: number, reason: string): Promise<void> {
    await this.db.$executeRaw`
      UPDATE agents
      SET
        last_agent_disconnected_at = ${new Date()},
        last_agent_disconnect_reason = ${reason}
      WHERE id = ${id}
    `.catch(() => { /* ignore */ })
  }

  // ── Log de conexão/desconexão (chamado pelo gateway) ────────────────────────

  async logConnected(agentId: number, agentName: string, agentMode: string, createdById: number): Promise<void> {
    await this.db.adminLog.create({
      data: {
        adminId:    createdById,
        action:     'agent_connected',
        targetType: 'agent',
        targetId:   agentId,
        details:    JSON.stringify({ agentId, agentName, agentMode, createdBy: createdById }),
      },
    }).catch(() => { /* best-effort */ })
  }

  async logDisconnected(agentId: number, agentName: string, agentMode: string, createdById: number, reason: string): Promise<void> {
    await this.db.adminLog.create({
      data: {
        adminId:    createdById,
        action:     'agent_disconnected',
        targetType: 'agent',
        targetId:   agentId,
        details:    JSON.stringify({ agentId, agentName, agentMode, createdBy: createdById, reason }),
      },
    }).catch(() => { /* best-effort */ })
  }
}
