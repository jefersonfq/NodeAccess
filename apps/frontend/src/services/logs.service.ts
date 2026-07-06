import api from './api'
import type { AuthLogPublic, AdminLogPublic, ClientUxEvent } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'

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
  openedAt: string
  lastActivityAt: string
  expiresAt: string
  closedAt: string | null
  closeReason: string | null
  inputBytes: number
  outputBytesRead: number
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
  executedAt: string
}

export const logsService = {
  listAuth(params: { eventType?: string; success?: boolean; search?: string; page?: number; limit?: number }) {
    return api.get<Paginated<AuthLogPublic>>('/logs/auth', { params })
  },
  listAdmin(params: {
    search?: string
    action?: string
    actions?: string
    actionPrefix?: string
    targetType?: string
    targetId?: number
    mcpTokenId?: number
    mcpAuthMode?: string
    page?: number
    limit?: number
  }) {
    return api.get<Paginated<AdminLogPublic>>('/logs/admin', { params })
  },
  listMcpInteractiveSessions(params: {
    search?: string
    status?: string
    hostId?: number
    tokenId?: number
    page?: number
    limit?: number
  }) {
    return api.get<Paginated<McpInteractiveSshSessionPublic>>('/logs/mcp-interactive-sessions', { params })
  },
  listSnippetExecutions(params: {
    search?: string
    status?: string
    userId?: number
    snippetId?: number
    hostId?: number
    dateFrom?: string
    dateTo?: string
    page?: number
    limit?: number
  }) {
    return api.get<Paginated<SnippetExecutionPublic>>('/logs/snippet-executions', { params })
  },
  closeMcpInteractiveSession(sessionId: string) {
    return api.post(`/logs/mcp-interactive-sessions/${encodeURIComponent(sessionId)}/close`)
  },
  recordClientUx(events: ClientUxEvent[]) {
    return api.post('/logs/client-ux', { events })
  },
}
