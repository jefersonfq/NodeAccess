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

export type AgentType = 'PROXY_AGENT' | 'PRIVATE_ACCESS_CONNECTOR'
export type AgentMode = 'USER_BOUND' | 'SERVICE_BOUND'

export interface PrivateAccessConfig {
  siteName?: string | null
  environment?: string | null
  allowedCidrs?: string[]
  allowedHostnames?: string[]
  allowedPorts?: number[]
  allowedHostTags?: string[]
  allowFallback?: boolean
}

export interface CreateAgentInput {
  name: string
  agentMode?: AgentMode
  agentType?: AgentType
  privateAccess?: PrivateAccessConfig
}

function agentSnapshot(agent: { id: number; name: string; agentMode: string; createdById: number; agentType?: string }) {
  return JSON.stringify({
    agentId:   agent.id,
    agentName: agent.name,
    agentType: agent.agentType ?? 'PROXY_AGENT',
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
  lastAgentConnectedAt: Date | string | null
  lastAgentDisconnectedAt: Date | string | null
  lastAgentDisconnectReason: string | null
}

interface AgentListRow {
  id: number
  name: string
  active: boolean | number
  agentType: AgentType
  agentMode: AgentMode
  isDefault: boolean | number
  maintenanceMode: boolean | number
  drainStartedAt: Date | string | null
  poolName: string | null
  priority: number
  siteName: string | null
  environment: string | null
  privateAccessAllowedCidrsJson: unknown
  privateAccessAllowedHostnamesJson: unknown
  privateAccessAllowedPortsJson: unknown
  privateAccessAllowedHostTagsJson: unknown
  privateAccessAllowFallback: boolean | number
  revokedAt: Date | string | null
  lastSeenAt: Date | string | null
  createdAt: Date | string
  createdById: number
  createdByName: string
  createdByEmail: string
}

interface AgentStatusRow {
  id: number
  name: string
  agentType: AgentType
  agentMode: AgentMode
  isDefault: boolean | number
  createdById: number
  lastSeenAt: Date | string | null
  lastAgentConnectedAt: Date | string | null
  lastAgentDisconnectedAt: Date | string | null
}

interface CreatedAgentIdRow {
  id: number | bigint
}

interface AuthenticatedAgentRow {
  id: number
  tenantId: number
  createdById: number
  name: string
  agentType: AgentType
  agentMode: AgentMode
  isDefault: boolean | number
  maintenanceMode: boolean | number
  poolName: string | null
  priority: number
  siteName: string | null
  environment: string | null
  privateAccessAllowedCidrsJson: unknown
  privateAccessAllowedHostnamesJson: unknown
  privateAccessAllowedPortsJson: unknown
  privateAccessAllowedHostTagsJson: unknown
  privateAccessAllowFallback: boolean | number
}

const PERSISTED_AGENT_ONLINE_TTL_MS = 90_000
export const MIN_SUPPORTED_AGENT_VERSION = '1.0.0'

export function agentVersionStatus(version: string | null | undefined): 'current' | 'outdated' | 'unknown' {
  if (!version) return 'unknown'
  const numbers = (value: string) => value.split(/[.-]/).slice(0, 3).map(part => Number(part) || 0)
  const current = numbers(version)
  const minimum = numbers(MIN_SUPPORTED_AGENT_VERSION)
  for (let index = 0; index < 3; index += 1) {
    if (current[index]! > minimum[index]!) return 'current'
    if (current[index]! < minimum[index]!) return 'outdated'
  }
  return 'current'
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

function portList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= 65535)
  return items.length > 0 ? Array.from(new Set(items)) : undefined
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function jsonParam(value: string[] | number[] | undefined): string | null {
  return value && value.length > 0 ? JSON.stringify(value) : null
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function isPersistedOnline(
  connectedAt: Date | string | null,
  disconnectedAt: Date | string | null,
  lastSeenAt: Date | string | null,
): boolean {
  if (!connectedAt || disconnectedAt || !lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() <= PERSISTED_AGENT_ONLINE_TTL_MS
}

export class AgentService {
  constructor(
    private readonly db: PrismaClient,
    private readonly licenseEntitlementService: LicenseEntitlementService,
  ) {}

  // ── Listar agentes — usuário vê os próprios; admin vê todos do tenant ─────────

  async list(userId: number, tenantId: number, isAdmin = false) {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const agents = await this.db.$queryRaw<AgentListRow[]>(Prisma.sql`
      SELECT
        a.id,
        a.name,
        a.active,
        COALESCE(a.agent_type, 'PROXY_AGENT') AS agentType,
        a.agent_mode AS agentMode,
        a.is_default AS isDefault,
        a.maintenance_mode AS maintenanceMode,
        a.drain_started_at AS drainStartedAt,
        a.pool_name AS poolName,
        a.priority,
        a.site_name AS siteName,
        a.environment,
        a.private_access_allowed_cidrs_json AS privateAccessAllowedCidrsJson,
        a.private_access_allowed_hostnames_json AS privateAccessAllowedHostnamesJson,
        a.private_access_allowed_ports_json AS privateAccessAllowedPortsJson,
        a.private_access_allowed_host_tags_json AS privateAccessAllowedHostTagsJson,
        a.private_access_allow_fallback AS privateAccessAllowFallback,
        a.revoked_at AS revokedAt,
        a.last_seen_at AS lastSeenAt,
        a.created_at AS createdAt,
        u.id AS createdById,
        u.name AS createdByName,
        u.email AS createdByEmail
      FROM agents a
      JOIN users u ON u.id = a.created_by
      WHERE
        a.tenant_id = ${tenantId}
        AND a.deleted_at IS NULL
        ${isAdmin ? Prisma.empty : Prisma.sql`AND a.created_by = ${userId}`}
      ORDER BY a.created_at DESC
    `)
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
      const persistedOnline = isPersistedOnline(
        last?.lastAgentConnectedAt ?? null,
        last?.lastAgentDisconnectedAt ?? null,
        a.lastSeenAt,
      )
      const effectiveVersion = runtime?.version ?? last?.lastAgentVersion ?? null
      return {
        id:                a.id,
        name:              a.name,
        active:            Boolean(a.active),
        agentType:         a.agentType,
        agentMode:         a.agentMode,
        isDefault:         Boolean(a.isDefault),
        maintenanceMode:   Boolean(a.maintenanceMode),
        drainStartedAt:    toIso(a.drainStartedAt),
        poolName:          a.poolName,
        priority:          a.priority,
        siteName:          a.siteName,
        environment:       a.environment,
        privateAccess:     a.agentType === 'PRIVATE_ACCESS_CONNECTOR'
          ? {
              allowedCidrs:     jsonArray(a.privateAccessAllowedCidrsJson),
              allowedHostnames: jsonArray(a.privateAccessAllowedHostnamesJson),
              allowedPorts:     jsonArray(a.privateAccessAllowedPortsJson),
              allowedHostTags:  jsonArray(a.privateAccessAllowedHostTagsJson),
              allowFallback:    Boolean(a.privateAccessAllowFallback),
            }
          : null,
        revokedAt:         toIso(a.revokedAt),
        lastSeenAt:        toIso(a.lastSeenAt),
        createdAt:         toIso(a.createdAt) ?? new Date().toISOString(),
        owner:             isAdmin ? { id: a.createdById, name: a.createdByName, email: a.createdByEmail } : undefined,
        online:            runtime !== undefined || persistedOnline,
        version:           effectiveVersion,
        versionStatus:     agentVersionStatus(effectiveVersion),
        minimumSupportedVersion: MIN_SUPPORTED_AGENT_VERSION,
        hostname:          runtime?.hostname ?? last?.lastAgentHostname ?? null,
        platform:          runtime?.platform ?? last?.lastAgentPlatform ?? null,
        arch:              runtime?.arch     ?? last?.lastAgentArch     ?? null,
        remoteIp:          runtime?.remoteIp ?? last?.lastAgentRemoteIp ?? null,
        connectedAt:       runtime?.connectedAt?.toISOString() ?? toIso(last?.lastAgentConnectedAt ?? null),
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
        tlsMode:           runtime?.tlsMode ?? null,
        heartbeatAgeMs:    runtime?.lastPongAt ? Math.max(0, Date.now() - runtime.lastPongAt.getTime()) : null,
      }
    })
  }

  async status(userId: number, tenantId: number): Promise<{
    userAgent: { id: number; name: string } | null
    tenantAgent: { id: number; name: string } | null
    privateAccessConnector: { id: number; name: string } | null
  }> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')

    const runtimeUserAgent = agentRegistry.getForUser(userId)
    const runtimeTenantAgent = agentRegistry.getForTenant(tenantId)
    const runtimePrivateAccessConnector = agentRegistry.getPrivateAccessForTenant(tenantId)

    const rows = await this.db.$queryRaw<AgentStatusRow[]>(Prisma.sql`
      SELECT
        id,
        name,
        agent_type AS agentType,
        agent_mode AS agentMode,
        is_default AS isDefault,
        created_by AS createdById,
        last_seen_at AS lastSeenAt,
        last_agent_connected_at AS lastAgentConnectedAt,
        last_agent_disconnected_at AS lastAgentDisconnectedAt
      FROM agents
      WHERE
        tenant_id = ${tenantId}
        AND active = 1
        AND maintenance_mode = 0
        AND deleted_at IS NULL
        AND (created_by = ${userId} OR agent_mode = 'SERVICE_BOUND')
      ORDER BY
        is_default DESC,
        last_seen_at DESC
    `)

    const persistedUserAgent = rows.find((agent) =>
      agent.agentMode === 'USER_BOUND'
      && agent.createdById === userId
      && isPersistedOnline(agent.lastAgentConnectedAt, agent.lastAgentDisconnectedAt, agent.lastSeenAt),
    )
    const persistedTenantAgent = rows.find((agent) =>
      agent.agentMode === 'SERVICE_BOUND'
      && agent.agentType === 'PROXY_AGENT'
      && isPersistedOnline(agent.lastAgentConnectedAt, agent.lastAgentDisconnectedAt, agent.lastSeenAt),
    )
    const persistedPrivateAccessConnector = rows.find((agent) =>
      agent.agentMode === 'SERVICE_BOUND'
      && agent.agentType === 'PRIVATE_ACCESS_CONNECTOR'
      && isPersistedOnline(agent.lastAgentConnectedAt, agent.lastAgentDisconnectedAt, agent.lastSeenAt),
    )

    return {
      userAgent: runtimeUserAgent
        ? { id: runtimeUserAgent.agentId, name: runtimeUserAgent.name }
        : persistedUserAgent
          ? { id: persistedUserAgent.id, name: persistedUserAgent.name }
          : null,
      tenantAgent: runtimeTenantAgent
        ? { id: runtimeTenantAgent.agentId, name: runtimeTenantAgent.name }
        : persistedTenantAgent
          ? { id: persistedTenantAgent.id, name: persistedTenantAgent.name }
          : null,
      privateAccessConnector: runtimePrivateAccessConnector
        ? { id: runtimePrivateAccessConnector.agentId, name: runtimePrivateAccessConnector.name }
        : persistedPrivateAccessConnector
          ? { id: persistedPrivateAccessConnector.id, name: persistedPrivateAccessConnector.name }
          : null,
    }
  }

  // ── Criar agente + retornar token em plaintext (única vez) ──────────────────

  async create(userId: number, tenantId: number, input: CreateAgentInput): Promise<{ agent: object; token: string }> {
    await this.licenseEntitlementService.requireFeature(tenantId, 'agents', 'Agentes não licenciados para este tenant')
    const name = cleanText(input.name)
    if (!name) throw new AppError('Nome do agente é obrigatório', 400, 'AGENT_NAME_REQUIRED')
    const agentType = input.agentType ?? 'PROXY_AGENT'
    let agentMode = input.agentMode ?? 'USER_BOUND'

    if (agentType === 'PRIVATE_ACCESS_CONNECTOR') {
      agentMode = 'SERVICE_BOUND'
    }

    const token = generateToken()
    const privateAccess = input.privateAccess ?? {}
    const created = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO agents (
          tenant_id,
          created_by,
          name,
          token_hash,
          agent_type,
          agent_mode,
          site_name,
          environment,
          private_access_allowed_cidrs_json,
          private_access_allowed_hostnames_json,
          private_access_allowed_ports_json,
          private_access_allowed_host_tags_json,
          private_access_allow_fallback,
          created_at,
          updated_at
        )
        VALUES (
          ${tenantId},
          ${userId},
          ${name},
          ${hashToken(token)},
          ${agentType},
          ${agentMode},
          ${cleanText(privateAccess.siteName) ?? null},
          ${cleanText(privateAccess.environment) ?? null},
          ${jsonParam(stringList(privateAccess.allowedCidrs))},
          ${jsonParam(stringList(privateAccess.allowedHostnames))},
          ${jsonParam(portList(privateAccess.allowedPorts))},
          ${jsonParam(stringList(privateAccess.allowedHostTags))},
          ${privateAccess.allowFallback ?? false},
          ${new Date()},
          ${new Date()}
        )
      `
      const rows = await tx.$queryRaw<CreatedAgentIdRow[]>`SELECT LAST_INSERT_ID() AS id`
      return rows[0]
    })
    if (!created) throw new AppError('Erro ao criar agente', 500, 'AGENT_CREATE_FAILED')
    const agentId = Number(created.id)
    if (!Number.isSafeInteger(agentId) || agentId <= 0) {
      throw new AppError('Erro ao criar agente', 500, 'AGENT_CREATE_FAILED')
    }
    const agent = { id: agentId, name, agentType, agentMode, createdAt: new Date() }
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
    agentRegistry.disconnectById(agent.id, 'Agente revogado no NodeAccess')
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
    await this.db.$executeRaw`
      UPDATE hosts
      SET private_access_connector_id = NULL
      WHERE tenant_id = ${tenantId}
        AND private_access_connector_id = ${agent.id}
    `
    agentRegistry.disconnectById(agent.id, 'Agente excluído no NodeAccess')
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

  async impact(id: number, userId: number, tenantId: number, isAdmin = false) {
    const agent = await this.manageableAgent(id, userId, tenantId, isAdmin)
    const [hosts, sessions] = await Promise.all([
      this.db.$queryRaw<Array<{ count: number | bigint }>>`
        SELECT COUNT(*) AS count FROM hosts
        WHERE tenant_id = ${tenantId} AND private_access_connector_id = ${agent.id} AND deleted_at IS NULL
      `,
      this.db.$queryRaw<Array<{ count: number | bigint }>>`
        SELECT COUNT(*) AS count FROM sessions s
        JOIN hosts h ON h.id = s.host_id
        WHERE h.tenant_id = ${tenantId} AND s.agent_id = ${agent.id} AND s.ended_at IS NULL
      `,
    ])
    const activeConnections = agentRegistry.activeConnectionsForAgent(agent.id)
    return {
      hostCount: Number(hosts[0]?.count ?? 0),
      activeSessionCount: Math.max(Number(sessions[0]?.count ?? 0), activeConnections),
      online: Boolean(agentRegistry.getActiveById(agent.id)),
      safeToRevoke: Number(hosts[0]?.count ?? 0) === 0 && activeConnections === 0,
    }
  }

  async setMaintenance(id: number, userId: number, tenantId: number, isAdmin: boolean, enabled: boolean) {
    const agent = await this.manageableAgent(id, userId, tenantId, isAdmin)
    await this.db.$executeRaw`
      UPDATE agents SET maintenance_mode = ${enabled}, drain_started_at = ${enabled ? new Date() : null}
      WHERE id = ${agent.id} AND tenant_id = ${tenantId}
    `
    agentRegistry.setMaintenance(agent.id, enabled)
    await this.auditOperation(userId, agent, enabled ? 'agent_drain_started' : 'agent_maintenance_ended')
    return { maintenanceMode: enabled, activeConnections: agentRegistry.activeConnectionsForAgent(agent.id) }
  }

  async rotateToken(id: number, userId: number, tenantId: number, isAdmin = false) {
    const agent = await this.manageableAgent(id, userId, tenantId, isAdmin)
    const token = generateToken()
    await this.db.agent.update({ where: { id: agent.id }, data: { tokenHash: hashToken(token) } })
    await this.auditOperation(userId, agent, 'agent_token_rotated')
    return { token }
  }

  async configurePool(id: number, userId: number, tenantId: number, isAdmin: boolean, input: { poolName?: string | null; priority?: number }) {
    const agent = await this.manageableAgent(id, userId, tenantId, isAdmin)
    if (agent.agentMode !== 'SERVICE_BOUND') throw new AppError('Pool é permitido apenas para agentes compartilhados', 400, 'AGENT_POOL_MODE_INVALID')
    const priority = Math.min(1000, Math.max(1, Math.trunc(input.priority ?? 100)))
    const poolName = cleanText(input.poolName) ?? null
    await this.db.$executeRaw`
      UPDATE agents SET pool_name = ${poolName}, priority = ${priority}
      WHERE id = ${agent.id} AND tenant_id = ${tenantId}
    `
    await this.auditOperation(userId, agent, 'agent_pool_updated')
    return { poolName, priority }
  }

  async history(id: number, userId: number, tenantId: number, isAdmin = false) {
    const agent = await this.manageableAgent(id, userId, tenantId, isAdmin)
    const events = await this.db.$queryRaw<Array<{ action: string; createdAt: Date }>>`
      SELECT action, timestamp AS createdAt FROM admin_logs
      WHERE target_type = 'agent' AND target_id = ${agent.id}
      ORDER BY timestamp DESC LIMIT 50
    `
    return { events, reconnects: events.filter(item => item.action === 'agent_connected').length, disconnects: events.filter(item => item.action === 'agent_disconnected').length }
  }

  private async manageableAgent(id: number, userId: number, tenantId: number, isAdmin: boolean) {
    const agent = await this.db.agent.findFirst({ where: { id, tenantId, deletedAt: null }, select: { id: true, name: true, agentType: true, agentMode: true, createdById: true } })
    if (!agent) throw new AppError('Agente não encontrado', 404, 'AGENT_NOT_FOUND')
    if (!isAdmin && agent.createdById !== userId) throw new AppError('Sem permissão', 403, 'AGENT_FORBIDDEN')
    return agent
  }

  private async auditOperation(userId: number, agent: { id: number; name: string; agentType: AgentType; agentMode: AgentMode; createdById: number }, action: string) {
    await this.db.adminLog.create({ data: { adminId: userId, action, targetType: 'agent', targetId: agent.id, details: agentSnapshot(agent) } }).catch(() => {})
  }

  // ── Autenticar agente pelo token (usado no WebSocket gateway) ───────────────

  async authenticate(rawToken: string): Promise<{
    id: number
    tenantId: number
    createdById: number
    name: string
    agentType: AgentType
    agentMode: AgentMode
    isDefault: boolean
    poolName: string | null
    priority: number
    siteName: string | null
    environment: string | null
    privateAccess: PrivateAccessConfig | null
  } | null> {
    const hash  = hashToken(rawToken)
    const rows = await this.db.$queryRaw<AuthenticatedAgentRow[]>`
      SELECT
        id,
        tenant_id AS tenantId,
        created_by AS createdById,
        name,
        COALESCE(agent_type, 'PROXY_AGENT') AS agentType,
        agent_mode AS agentMode,
        is_default AS isDefault,
        maintenance_mode AS maintenanceMode,
        pool_name AS poolName,
        priority,
        site_name AS siteName,
        environment,
        private_access_allowed_cidrs_json AS privateAccessAllowedCidrsJson,
        private_access_allowed_hostnames_json AS privateAccessAllowedHostnamesJson,
        private_access_allowed_ports_json AS privateAccessAllowedPortsJson,
        private_access_allowed_host_tags_json AS privateAccessAllowedHostTagsJson,
        private_access_allow_fallback AS privateAccessAllowFallback
      FROM agents
      WHERE token_hash = ${hash}
        AND active = 1
        AND maintenance_mode = 0
        AND deleted_at IS NULL
      LIMIT 1
    `
    const agent = rows[0]
    return agent
      ? {
          ...agent,
          isDefault: Boolean(agent.isDefault),
          privateAccess: agent.agentType === 'PRIVATE_ACCESS_CONNECTOR'
            ? {
                siteName: agent.siteName,
                environment: agent.environment,
                allowedCidrs: jsonArray(agent.privateAccessAllowedCidrsJson).filter((item): item is string => typeof item === 'string'),
                allowedHostnames: jsonArray(agent.privateAccessAllowedHostnamesJson).filter((item): item is string => typeof item === 'string'),
                allowedPorts: jsonArray(agent.privateAccessAllowedPortsJson)
                  .map((item) => Number(item))
                  .filter((item) => Number.isInteger(item) && item > 0 && item <= 65535),
                allowedHostTags: jsonArray(agent.privateAccessAllowedHostTagsJson).filter((item): item is string => typeof item === 'string'),
                allowFallback: Boolean(agent.privateAccessAllowFallback),
              }
            : null,
        }
      : null
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

  async logConnected(agentId: number, agentName: string, agentType: string, agentMode: string, createdById: number, diagnostics: AgentRuntimeDiagnostics = {}): Promise<void> {
    await this.db.adminLog.create({
      data: {
        adminId:    createdById,
        action:     'agent_connected',
        targetType: 'agent',
        targetId:   agentId,
        details:    JSON.stringify({ agentId, agentName, agentType, agentMode, createdBy: createdById, ...diagnostics }),
      },
    }).catch(() => { /* best-effort */ })
  }

  async logDisconnected(agentId: number, agentName: string, agentType: string, agentMode: string, createdById: number, reason: string, diagnostics: AgentRuntimeDiagnostics = {}): Promise<void> {
    await this.db.adminLog.create({
      data: {
        adminId:    createdById,
        action:     'agent_disconnected',
        targetType: 'agent',
        targetId:   agentId,
        details:    JSON.stringify({ agentId, agentName, agentType, agentMode, createdBy: createdById, reason, ...diagnostics }),
      },
    }).catch(() => { /* best-effort */ })
  }
}
