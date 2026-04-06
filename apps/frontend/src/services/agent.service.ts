import api from './api'

export interface AgentInfo {
  id:         number
  name:       string
  active:     boolean
  online:     boolean
  lastSeenAt: string | null
  createdAt:  string
}

export interface CreateAgentResult {
  agent: { id: number; name: string; createdAt: string }
  token: string  // plaintext — exibir apenas uma vez
}

export interface AgentDownloadInfo {
  platform: 'windows' | 'linux' | 'macos'
  fileName: string
  available: boolean
  downloadUrl: string
}

export const agentService = {
  list() {
    return api.get<AgentInfo[]>('/agents')
  },

  downloads() {
    return api.get<AgentDownloadInfo[]>('/agents/downloads')
  },

  create(name: string) {
    return api.post<CreateAgentResult>('/agents', { name })
  },

  revoke(id: number) {
    return api.delete(`/agents/${id}`)
  },
}
