import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

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

export interface McpProbeStep {
  key: 'authentication' | 'initialize' | 'tools' | 'resources' | 'prompts' | 'read_only_tool'
  label: string
  status: 'passed' | 'skipped' | 'failed'
  durationMs: number
  detail: string
}

export interface McpAgentSetup {
  endpoint: string
  codexRegister: string
  codexStartBash: string
  codexStartPowerShell: string
  genericHttpConfig: string
}

export function buildMcpAgentSetup(baseUrl: string): McpAgentSetup {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/mcp/jsonrpc`
  return {
    endpoint,
    codexRegister: `codex mcp add nodeaccess --url ${endpoint} --bearer-token-env-var NODEACCESS_MCP_TOKEN`,
    codexStartBash: `read -rsp "Token MCP: " NODEACCESS_MCP_TOKEN; echo\nexport NODEACCESS_MCP_TOKEN\ncodex`,
    codexStartPowerShell: `$env:NODEACCESS_MCP_TOKEN = Read-Host -MaskInput "Token MCP"\ncodex`,
    genericHttpConfig: JSON.stringify({
      transport: 'streamable_http',
      url: endpoint,
      headers: { Authorization: 'Bearer ${NODEACCESS_MCP_TOKEN}' },
    }, null, 2),
  }
}

function assertJsonRpcResult(payload: unknown): void {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  if (!record || record.error || !('result' in record)) throw new Error('Invalid MCP JSON-RPC response')
}

const adminCapabilitiesCache = createTimedPromiseCache<{ data: McpCapabilityDefinition[] }>(
  cacheTtls.mcpCapabilities,
  { name: 'mcp:admin-capabilities' },
)

function probeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Tempo limite excedido.'
  return 'A chamada não foi aceita. Verifique token, capability e disponibilidade do servidor.'
}

async function probeRequest(fetcher: typeof fetch, url: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetcher(url, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) throw new Error(`MCP probe failed with HTTP ${response.status}`)
    return await response.json()
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function runMcpReadOnlyProbe(
  token: string,
  baseUrl: string,
  allowedCapabilities: string[],
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<McpProbeStep[]> {
  const steps: McpProbeStep[] = []
  const execute = async (key: McpProbeStep['key'], label: string, request: () => Promise<unknown>) => {
    const startedAt = performance.now()
    try {
      await request()
      steps.push({ key, label, status: 'passed', durationMs: Math.round(performance.now() - startedAt), detail: 'Resposta válida recebida.' })
      return true
    } catch (error) {
      steps.push({ key, label, status: 'failed', durationMs: Math.round(performance.now() - startedAt), detail: probeErrorMessage(error) })
      return false
    }
  }

  const authenticated = await execute('authentication', 'Autenticação e capabilities', () =>
    probeRequest(fetcher, `${baseUrl}/mcp/capabilities`, token))
  if (!authenticated) return steps

  const jsonRpc = async (id: string, method: string, params: Record<string, unknown> = {}) => {
    const payload = await probeRequest(fetcher, `${baseUrl}/mcp/jsonrpc`, token, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    assertJsonRpcResult(payload)
  }

  const initialized = await execute('initialize', 'Handshake MCP', () =>
    jsonRpc('nodeaccess-ui-probe-init', 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'nodeaccess-admin-probe', version: '1.0.0' },
    }))
  if (!initialized) return steps

  const catalogs = [
    ['tools', 'Catálogo de tools', 'tools/list'],
    ['resources', 'Catálogo de resources', 'resources/list'],
    ['prompts', 'Catálogo de prompts', 'prompts/list'],
  ] as const
  for (const [key, label, method] of catalogs) {
    const passed = await execute(key, label, () => jsonRpc(`nodeaccess-ui-probe-${key}`, method))
    if (!passed) return steps
  }

  if (allowedCapabilities.length > 0 && !allowedCapabilities.includes('search_hosts')) {
    steps.push({ key: 'read_only_tool', label: 'Consulta segura de hosts', status: 'skipped', durationMs: 0, detail: 'Token sem a capability search_hosts.' })
    return steps
  }

  await execute('read_only_tool', 'Consulta segura de hosts', () =>
    jsonRpc('nodeaccess-ui-probe-read', 'tools/call', { name: 'search_hosts', arguments: { query: 'a', limit: 1 } }))
  return steps
}

export const mcpService = {
  probeRuntime: () => api.post<{ jsonrpc: '2.0'; id: string; result?: { protocolVersion?: string; serverInfo?: { name?: string; version?: string } }; error?: { message?: string } }>('/mcp/jsonrpc', {
    jsonrpc: '2.0',
    id: 'nodeaccess-ui-runtime-status',
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'nodeaccess-admin-ui', version: '1.0.0' },
    },
  }),
  listCapabilities: () => api.get<{ actor: { userId: number; tenantId: number; role: 'admin' | 'user' }; capabilities: McpCapabilityDefinition[] }>('/mcp/capabilities'),
  listAdminCapabilities: (force = false) => {
    if (force) adminCapabilitiesCache.clear('manual-refresh')
    return adminCapabilitiesCache.get(() => api.get<McpCapabilityDefinition[]>('/mcp/admin/capabilities'))
  },
  clearCapabilitiesCache: () => adminCapabilitiesCache.clear('explicit-invalidation'),
  listTokens: () => api.get<McpTokenPublicRecord[]>('/mcp/admin/tokens'),
  createToken: (dto: { name: string; allowedCapabilities?: string[]; allowedActionModes?: string[]; allowedHostIds?: number[]; expiresAt?: string | null }) => api.post<McpTokenCreateResult>('/mcp/admin/tokens', dto),
  updateToken: (id: number, dto: { name: string; allowedCapabilities?: string[]; allowedActionModes?: string[]; allowedHostIds?: number[]; expiresAt?: string | null }) => api.patch<McpTokenPublicRecord>(`/mcp/admin/tokens/${id}`, dto),
  revokeToken: (id: number) => api.post<McpTokenPublicRecord>(`/mcp/admin/tokens/${id}/revoke`),
}
