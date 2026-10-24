import type { AxiosPromise } from 'axios'
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

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-response')
  return value as Record<string, unknown>
}

function assertJsonRpcResult(payload: unknown, id: string): Record<string, unknown> {
  const envelope = record(payload)
  if (envelope.jsonrpc !== '2.0' || envelope.id !== id || 'error' in envelope) throw new Error('invalid-response')
  return record(envelope.result)
}

const adminCapabilitiesCache = createTimedPromiseCache<{ data: McpCapabilityDefinition[] }>(
  cacheTtls.mcpCapabilities,
  { name: 'mcp:admin-capabilities' },
)

class ProbeHttpError extends Error {
  constructor(readonly status: number) { super('http-failure') }
}

function probeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Tempo limite excedido. Verifique rede e disponibilidade.'
  if (error instanceof ProbeHttpError) {
    if (error.status === 401) return 'Token inválido, expirado ou revogado. Confira a credencial.'
    if (error.status === 403) return 'Acesso negado. Confira licença, permissões e escopo do token.'
    if (error.status === 404 || error.status === 503) return 'MCP indisponível. Confira a habilitação do módulo e o endereço da instância.'
    if (error.status === 429) return 'Limite de chamadas atingido. Aguarde antes de repetir.'
  }
  return 'Resposta incompatível ou falha de rede/TLS. Confira o servidor e suas permissões.'
}

async function probeRequest(fetcher: typeof fetch, url: string, token: string, init: RequestInit = {}, notification = false): Promise<unknown> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetcher(url, {
      ...init, signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`, ...(init.headers ?? {}),
      },
    })
    if (!response.ok) throw new ProbeHttpError(response.status)
    if (notification) {
      if (response.status !== 202 || (await response.text()).length !== 0) throw new Error('invalid-notification-response')
      return null
    }
    return await response.json()
  } finally { globalThis.clearTimeout(timeout) }
}

export async function runMcpReadOnlyProbe(
  token: string,
  baseUrl: string,
  allowedCapabilities: string[],
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<McpProbeStep[]> {
  const steps: McpProbeStep[] = []
  // The browser must never send a token to an editable or third-party endpoint.
  const origin = globalThis.location?.origin ?? 'http://localhost'
  const base = new URL(baseUrl, origin)
  if (base.origin !== origin || base.pathname.replace(/\/$/, '') !== '/api/v1' || base.search || base.hash || base.username || base.password) {
    return [{ key: 'authentication', label: 'Autenticação', status: 'failed', durationMs: 0, detail: 'O teste está limitado à instância atual do NodeAccess.' }]
  }
  const path = base.pathname.replace(/\/$/, '')
  const execute = async (key: McpProbeStep['key'], label: string, request: () => Promise<unknown>): Promise<boolean> => {
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
  const authenticated = await execute('authentication', 'Autenticação e permissões', async () => {
    const payload = record(await probeRequest(fetcher, `${path}/mcp/capabilities`, token, { signal }))
    if (!Array.isArray(payload.capabilities)) throw new Error('invalid-capabilities')
  })
  if (!authenticated) return steps
  const jsonRpc = async (id: string, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const payload = await probeRequest(fetcher, `${path}/mcp/jsonrpc`, token, {
      method: 'POST', signal, headers: method === 'initialize' ? {} : { 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    return assertJsonRpcResult(payload, id)
  }
  const initialized = await execute('initialize', 'Handshake MCP completo', async () => {
    const result = await jsonRpc('nodeaccess-ui-probe-init', 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nodeaccess-admin-probe', version: '1.0.0' },
    })
    const server = record(result.serverInfo)
    record(result.capabilities)
    if (result.protocolVersion !== '2025-06-18' || typeof server.name !== 'string' || typeof server.version !== 'string') throw new Error('invalid-initialize')
    await probeRequest(fetcher, `${path}/mcp/jsonrpc`, token, {
      method: 'POST', signal, headers: { 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }, true)
  })
  if (!initialized) return steps
  let searchHostsAvailable = false
  const catalogs = [ ['tools', 'Ferramentas', 'tools/list'], ['resources', 'Recursos', 'resources/list'], ['prompts', 'Prompts', 'prompts/list'] ] as const
  for (const [key, label, method] of catalogs) {
    const passed = await execute(key, label, async () => {
      const result = await jsonRpc(`nodeaccess-ui-probe-${key}`, method)
      const entries = result[key]
      if (!Array.isArray(entries)) throw new Error('invalid-catalog')
      for (const entry of entries) {
        const item = record(entry)
        if (typeof item.name !== 'string' || !item.name) throw new Error('invalid-catalog-entry')
        if (key === 'tools' && record(item.inputSchema).type !== 'object') throw new Error('invalid-tool-schema')
        if (key === 'resources' && typeof item.uri !== 'string') throw new Error('invalid-resource')
      }
      if (key === 'tools') searchHostsAvailable = entries.some((item) => record(item).name === 'search_hosts')
    })
    if (!passed) return steps
  }
  if (!searchHostsAvailable || (allowedCapabilities.length > 0 && !allowedCapabilities.includes('search_hosts'))) {
    steps.push({ key: 'read_only_tool', label: 'Consulta segura de hosts', status: 'skipped', durationMs: 0, detail: 'search_hosts não está disponível para este token.' })
    return steps
  }
  await execute('read_only_tool', 'Consulta segura de hosts', async () => {
    const result = await jsonRpc('nodeaccess-ui-probe-read', 'tools/call', { name: 'search_hosts', arguments: { query: 'a', limit: 1 } })
    if (result.isError === true || !Array.isArray(result.content) || result.content.some((item) => {
      const content = record(item)
      return content.type !== 'text' || typeof content.text !== 'string'
    })) throw new Error('invalid-tool-result')
  })
  return steps
}

type McpRuntimeResponse = { jsonrpc: '2.0'; id: string; result?: { protocolVersion?: string; serverInfo?: { name?: string; version?: string } }; error?: { message?: string } }
type McpCapabilitiesResponse = { actor: { userId: number; tenantId: number; role: 'admin' | 'user' }; capabilities: McpCapabilityDefinition[] }

export const mcpService = {
  probeRuntime: (): AxiosPromise<McpRuntimeResponse> => api.post<McpRuntimeResponse>('/mcp/jsonrpc', {
    jsonrpc: '2.0',
    id: 'nodeaccess-ui-runtime-status',
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'nodeaccess-admin-ui', version: '1.0.0' },
    },
  }, { headers: { Accept: 'application/json, text/event-stream' } }),
  listCapabilities: (): AxiosPromise<McpCapabilitiesResponse> => api.get<McpCapabilitiesResponse>('/mcp/capabilities'),
  listAdminCapabilities: (force = false): Promise<{ data: McpCapabilityDefinition[] }> => {
    if (force) adminCapabilitiesCache.clear('manual-refresh')
    return adminCapabilitiesCache.get(() => api.get<McpCapabilityDefinition[]>('/mcp/admin/capabilities'))
  },
  clearCapabilitiesCache: (): void => adminCapabilitiesCache.clear('explicit-invalidation'),
  listTokens: (): AxiosPromise<McpTokenPublicRecord[]> => api.get<McpTokenPublicRecord[]>('/mcp/admin/tokens'),
  createToken: (dto: { name: string; allowedCapabilities?: string[]; allowedActionModes?: string[]; allowedHostIds?: number[]; expiresAt?: string | null }): AxiosPromise<McpTokenCreateResult> => api.post<McpTokenCreateResult>('/mcp/admin/tokens', dto),
  updateToken: (id: number, dto: { name: string; allowedCapabilities?: string[]; allowedActionModes?: string[]; allowedHostIds?: number[]; expiresAt?: string | null }): AxiosPromise<McpTokenPublicRecord> => api.patch<McpTokenPublicRecord>(`/mcp/admin/tokens/${id}`, dto),
  revokeToken: (id: number): AxiosPromise<McpTokenPublicRecord> => api.post<McpTokenPublicRecord>(`/mcp/admin/tokens/${id}/revoke`),
}
