import type { AuthLogPublic, AdminLogPublic } from '@nodeaccess/shared'
import type { ClientUxEvent } from '@nodeaccess/shared'
import type { UserProductivityEvent } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'
import type { JwtPayload } from '../../shared/guards.js'
import type { McpInteractiveSshService } from '../mcp/mcp-interactive-ssh.service.js'
import type {
  LogRepository,
  AuthLogFilters,
  AdminLogFilters,
  McpInteractiveSshSessionFilters,
  SnippetExecutionFilters,
  AuthLogRow,
  AdminLogRow,
  McpInteractiveSshSessionRow,
  SnippetExecutionRow,
} from './log.repository.js'

function toAuthLogPublic(row: AuthLogRow): AuthLogPublic {
  return {
    id:        row.id,
    userId:    row.userId ?? null,
    userName:  row.user?.name  ?? null,
    userEmail: row.user?.email ?? null,
    eventType: row.eventType as AuthLogPublic['eventType'],
    ip:        row.ip        ?? null,
    userAgent: row.userAgent ?? null,
    success:   row.success,
    timestamp: row.timestamp,
  }
}

function toAdminLogPublic(row: AdminLogRow): AdminLogPublic {
  return {
    id:         row.id,
    adminId:    row.adminId,
    adminName:  row.admin.name,
    action:     row.action,
    targetType: row.targetType,
    targetId:   row.targetId,
    details:    row.details ?? null,
    timestamp:  row.timestamp,
  }
}

const INVENTORY_ACL_AUDIT_ACTIONS = [
  'UPSERT_INVENTORY_ACL',
  'DELETE_INVENTORY_ACL',
  'INVENTORY_ACL_SESSION_REVOKED',
  'INVENTORY_ACL_HOSTS_MOVED',
] as const

export interface McpInteractiveSshSessionPublic {
  id: number
  sessionId: string
  tenantId: number
  userId: number
  userName: string
  userEmail: string
  tokenId: number | null
  hostId: number
  hostName: string
  reason: string
  status: string
  openedAt: Date
  lastActivityAt: Date
  expiresAt: Date
  closedAt: Date | null
  closeReason: string | null
  inputBytes: number
  outputBytesRead: number
}

function toMcpInteractiveSshSessionPublic(row: McpInteractiveSshSessionRow): McpInteractiveSshSessionPublic {
  return { ...row }
}

export interface SnippetExecutionPublic {
  id: number
  tenantId: number
  userId: number
  userName: string
  userEmail: string
  snippetId: number | null
  snippetName: string | null
  snippetScope: string | null
  hostId: number | null
  hostName: string | null
  sessionId: number | null
  executionId: string
  source: string
  status: string
  executedAt: Date
}

function toSnippetExecutionPublic(row: SnippetExecutionRow): SnippetExecutionPublic {
  return { ...row }
}

const screenNamesById: Record<number, string> = {
  1: 'Início',
  2: 'Hosts',
  3: 'Terminal',
  4: 'Arquivos',
  5: 'Snippets',
  6: 'Túneis SSH',
  7: 'Meu perfil',
  100: 'Dashboard administrativo',
  101: 'Logs',
  102: 'Relatório de sessões',
  103: 'Auditoria de sessões',
  104: 'Usuários',
  105: 'Grupos',
  106: 'Integrações',
  107: 'Configurações',
}

export class LogService {
  constructor(
    private readonly logRepo: LogRepository,
    private readonly mcpInteractiveSshService?: McpInteractiveSshService,
  ) {}

  async listAuthLogs(
    tenantId: number,
    filters: AuthLogFilters,
  ): Promise<Paginated<AuthLogPublic>> {
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 30
    const { logs, total } = await this.logRepo.findAuthLogs(tenantId, filters)
    return { data: logs.map(toAuthLogPublic), total, page, limit }
  }

  async listAdminLogs(
    tenantId: number,
    filters: AdminLogFilters,
  ): Promise<Paginated<AdminLogPublic>> {
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 30
    const { logs, total } = await this.logRepo.findAdminLogs(tenantId, filters)
    return { data: logs.map(toAdminLogPublic), total, page, limit }
  }

  async listInventoryAclAudit(
    tenantId: number,
    filters: Pick<AdminLogFilters, 'search' | 'targetId' | 'page' | 'limit'>,
  ): Promise<Paginated<AdminLogPublic>> {
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 30
    const { logs, total } = await this.logRepo.findAdminLogs(tenantId, {
      ...filters,
      actions: [...INVENTORY_ACL_AUDIT_ACTIONS],
    })
    return { data: logs.map(toAdminLogPublic), total, page, limit }
  }

  async listMcpInteractiveSshSessions(
    tenantId: number,
    filters: McpInteractiveSshSessionFilters,
  ): Promise<Paginated<McpInteractiveSshSessionPublic>> {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 30
    const { sessions, total } = await this.logRepo.findMcpInteractiveSshSessions(tenantId, filters)
    return { data: sessions.map(toMcpInteractiveSshSessionPublic), total, page, limit }
  }

  async closeMcpInteractiveSshSession(
    user: JwtPayload,
    sessionId: string,
  ): Promise<Awaited<ReturnType<McpInteractiveSshService['closeAsAdmin']>>> {
    if (!this.mcpInteractiveSshService) {
      throw new Error('MCP interactive SSH service not configured')
    }
    return this.mcpInteractiveSshService.closeAsAdmin(user, { sessionId })
  }

  async listSnippetExecutions(
    tenantId: number,
    filters: SnippetExecutionFilters,
  ): Promise<Paginated<SnippetExecutionPublic>> {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 30
    const { executions, total } = await this.logRepo.findSnippetExecutions(tenantId, filters)
    return { data: executions.map(toSnippetExecutionPublic), total, page, limit }
  }

  async recordClientUxEvents(userId: number, events: ClientUxEvent[]): Promise<void> {
    for (const event of events) {
      await this.logRepo.logAdminEvent({
        adminId: userId,
        action: event,
        targetType: 'ClientUx',
        targetId: 0,
      })
    }
  }

  async recordUserProductivityEvents(
    userId: number,
    events: Array<{ event: UserProductivityEvent; targetId: number }>,
  ): Promise<void> {
    for (const item of events) {
      const targetType =
        item.event === 'USER_SNIPPET_EXECUTED'
          ? 'Snippet'
          : item.event === 'USER_SCREEN_VIEWED'
            ? 'Screen'
            : 'UserProductivity'

      const details = item.event === 'USER_SCREEN_VIEWED'
        ? JSON.stringify({ screenId: item.targetId, screenName: screenNamesById[item.targetId] ?? `Tela #${item.targetId}` })
        : undefined

      await this.logRepo.logAdminEvent({
        adminId: userId,
        action: item.event,
        targetType,
        targetId: item.targetId,
        ...(details !== undefined && { details }),
      })
    }
  }
}
