import api from './api'

export interface McpTokenPublicRecord {
  id: number
  name: string
  active: boolean
  allowedCapabilities: string[]
  allowedActionModes: string[]
  allowedHostIds: number[]
  lastUsage: {
    action: string
    capability: string | null
    authMode: string | null
    hostId: number | null
    runId: number | null
    timestamp: string
  } | null
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
  createdByName: string
  revokedByName: string | null
}

export interface McpCapabilityDefinition {
  key: string
  kind: 'resource' | 'tool' | 'prompt'
  title: string
  description: string
  module: string
  scope: string
  risk: 'low' | 'medium' | 'high'
  accessMode: 'read_only' | 'approval_required' | 'autonomous'
}

export interface McpTokenCreateResult {
  token: string
  record: McpTokenPublicRecord
}

export const mcpService = {
  listCapabilities: () => api.get<{ actor: { userId: number; tenantId: number; role: 'admin' | 'user' }; capabilities: McpCapabilityDefinition[] }>('/mcp/capabilities'),
  listAdminCapabilities: () => api.get<McpCapabilityDefinition[]>('/mcp/admin/capabilities'),
  listTokens: () => api.get<McpTokenPublicRecord[]>('/mcp/admin/tokens'),
  createToken: (dto: { name: string; allowedCapabilities?: string[]; allowedActionModes?: string[]; allowedHostIds?: number[]; expiresAt?: string | null }) => api.post<McpTokenCreateResult>('/mcp/admin/tokens', dto),
  updateToken: (id: number, dto: { name: string; allowedCapabilities?: string[]; allowedActionModes?: string[]; allowedHostIds?: number[]; expiresAt?: string | null }) => api.patch<McpTokenPublicRecord>(`/mcp/admin/tokens/${id}`, dto),
  revokeToken: (id: number) => api.post<McpTokenPublicRecord>(`/mcp/admin/tokens/${id}/revoke`),
}
