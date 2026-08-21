import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

export type AgentMode = 'USER_BOUND' | 'SERVICE_BOUND'
export type AgentType = 'PROXY_AGENT' | 'PRIVATE_ACCESS_CONNECTOR'

export interface PrivateAccessConfig {
  siteName?: string
  environment?: string
  allowedCidrs?: string[]
  allowedHostnames?: string[]
  allowedPorts?: number[]
  allowedHostTags?: string[]
  allowFallback?: boolean
}

export interface AgentInfo {
  id:                 number
  name:               string
  active:             boolean
  online:             boolean
  agentType:          AgentType
  agentMode:          AgentMode
  isDefault:          boolean
  siteName:           string | null
  environment:        string | null
  privateAccess:      PrivateAccessConfig | null
  revokedAt:          string | null
  lastSeenAt:         string | null
  createdAt:          string
  version:            string | null
  versionStatus?:     'current' | 'outdated' | 'unknown'
  minimumSupportedVersion?: string
  hostname:           string | null
  platform:           string | null
  arch:               string | null
  remoteIp:           string | null
  connectedAt:        string | null
  lastVersion:        string | null
  lastHostname:       string | null
  lastPlatform:       string | null
  lastArch:           string | null
  lastRemoteIp:       string | null
  lastConnectedAt:    string | null
  lastDisconnectedAt: string | null
  lastDisconnectReason: string | null
  lastOfflineReason:  string | null
  lastOfflineAt:      string | null
  tlsMode?:           'verified' | 'insecure' | null
  heartbeatAgeMs?:    number | null
  maintenanceMode?:   boolean
  drainStartedAt?:    string | null
  poolName?:          string | null
  priority?:          number
  owner?:             { id: number; name: string; email: string }
}

export interface CreateAgentResult {
  agent: { id: number; name: string; agentType: AgentType; agentMode: AgentMode; createdAt: string }
  token: string
}

export interface AgentStatusInfo {
  userAgent:   { id: number; name: string } | null
  tenantAgent: { id: number; name: string } | null
  privateAccessConnector: { id: number; name: string } | null
}

export interface AgentDownloadInfo {
  platform:    'windows' | 'linux' | 'macos'
  fileName:    string
  available:   boolean
  downloadUrl: string
}

const agentListCache = createTimedPromiseCache<{ data: AgentInfo[] }>(cacheTtls.agentsList, { name: 'agents:list' })
const agentStatusCache = createTimedPromiseCache<{ data: AgentStatusInfo }>(cacheTtls.agentsStatus, { name: 'agents:status' })
const agentDownloadsCache = createTimedPromiseCache<{ data: AgentDownloadInfo[] }>(cacheTtls.agentsDownloads, { name: 'agents:downloads' })

export const agentService = {
  list(options: { fresh?: boolean } = {}) {
    if (options.fresh) {
      agentListCache.clear('fresh-agent-list')
      agentStatusCache.clear('fresh-agent-list')
    }
    return agentListCache.get(() => api.get<AgentInfo[]>('/agents'))
  },

  status() {
    return agentStatusCache.get(() => api.get<AgentStatusInfo>('/agents/status'))
  },

  downloads() {
    return agentDownloadsCache.get(() => api.get<AgentDownloadInfo[]>('/agents/downloads'))
  },

  create(input: { name: string; agentMode?: AgentMode; agentType?: AgentType; privateAccess?: PrivateAccessConfig }) {
    return api.post<CreateAgentResult>('/agents', input).then((res) => {
      agentListCache.clear()
      agentStatusCache.clear()
      return res
    })
  },

  revoke(id: number) {
    return api.delete(`/agents/${id}`).then((res) => {
      agentListCache.clear()
      agentStatusCache.clear()
      return res
    })
  },

  permanentDelete(id: number) {
    return api.delete(`/agents/${id}/permanent`).then((res) => {
      agentListCache.clear()
      agentStatusCache.clear()
      return res
    })
  },

  reactivate(id: number) {
    return api.post(`/agents/${id}/reactivate`, {}).then((res) => {
      agentListCache.clear()
      agentStatusCache.clear()
      return res
    })
  },

  setDefault(id: number) {
    return api.post(`/agents/${id}/default`, {}).then((res) => {
      agentListCache.clear()
      agentStatusCache.clear()
      return res
    })
  },

  impact(id: number) {
    return api.get<{ hostCount: number; activeSessionCount: number; online: boolean; safeToRevoke: boolean }>(`/agents/${id}/impact`)
  },

  history(id: number) {
    return api.get<{ events: Array<{ action: string; createdAt: string }>; reconnects: number; disconnects: number }>(`/agents/${id}/history`)
  },

  setMaintenance(id: number, enabled: boolean) {
    return api.post<{ maintenanceMode: boolean; activeConnections: number }>(`/agents/${id}/maintenance`, { enabled }).then((res) => { agentListCache.clear(); agentStatusCache.clear(); return res })
  },

  rotateToken(id: number) {
    return api.post<{ token: string }>(`/agents/${id}/rotate-token`, {})
  },

  configurePool(id: number, input: { poolName?: string | null; priority?: number }) {
    return api.put<{ poolName: string | null; priority: number }>(`/agents/${id}/pool`, input).then((res) => { agentListCache.clear(); return res })
  },

  clear() {
    agentListCache.clear()
    agentStatusCache.clear()
    agentDownloadsCache.clear()
  },
}
