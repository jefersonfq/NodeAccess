import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

export type AgentMode = 'USER_BOUND' | 'SERVICE_BOUND'

export interface AgentInfo {
  id:                 number
  name:               string
  active:             boolean
  online:             boolean
  agentMode:          AgentMode
  isDefault:          boolean
  revokedAt:          string | null
  lastSeenAt:         string | null
  createdAt:          string
  version:            string | null
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
  owner?:             { id: number; name: string; email: string }
}

export interface CreateAgentResult {
  agent: { id: number; name: string; agentMode: AgentMode; createdAt: string }
  token: string
}

export interface AgentStatusInfo {
  userAgent:   { id: number; name: string } | null
  tenantAgent: { id: number; name: string } | null
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
  list() {
    return agentListCache.get(() => api.get<AgentInfo[]>('/agents'))
  },

  status() {
    return agentStatusCache.get(() => api.get<AgentStatusInfo>('/agents/status'))
  },

  downloads() {
    return agentDownloadsCache.get(() => api.get<AgentDownloadInfo[]>('/agents/downloads'))
  },

  create(name: string, agentMode: AgentMode = 'USER_BOUND') {
    return api.post<CreateAgentResult>('/agents', { name, agentMode }).then((res) => {
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

  clear() {
    agentListCache.clear()
    agentStatusCache.clear()
    agentDownloadsCache.clear()
  },
}
