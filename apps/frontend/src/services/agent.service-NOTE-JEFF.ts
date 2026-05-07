import api from './api'

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

export const agentService = {
  list() {
    return api.get<AgentInfo[]>('/agents')
  },

  status() {
    return api.get<AgentStatusInfo>('/agents/status')
  },

  downloads() {
    return api.get<AgentDownloadInfo[]>('/agents/downloads')
  },

  create(name: string, agentMode: AgentMode = 'USER_BOUND') {
    return api.post<CreateAgentResult>('/agents', { name, agentMode })
  },

  revoke(id: number) {
    return api.delete(`/agents/${id}`)
  },

  permanentDelete(id: number) {
    return api.delete(`/agents/${id}/permanent`)
  },

  reactivate(id: number) {
    return api.post(`/agents/${id}/reactivate`, {})
  },

  setDefault(id: number) {
    return api.post(`/agents/${id}/default`, {})
  },
}
