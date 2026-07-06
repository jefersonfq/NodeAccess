import api from './api'

export interface TunnelInfo {
  id:         string
  hostId:     number
  hostName:   string
  connectionMethod: 'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector'
  bindAddress: '127.0.0.1' | '0.0.0.0'
  localPort:  number
  requestedLocalPort: number
  assignedLocalPort: number
  usedPortFallback: boolean
  remoteHost: string
  remotePort: number
  createdAt:  string
  description?: string
}

export interface CreateTunnelDto {
  hostId:     number
  bindAddress?: '127.0.0.1' | '0.0.0.0'
  localPort:  number
  remoteHost: string
  remotePort: number
  description?: string
}

export interface TestTunnelTargetDto {
  hostId:     number
  remoteHost: string
  remotePort: number
}

export interface TunnelTargetTestResult {
  success: boolean
  message: string
  latencyMs: number | null
  connectionMethod: 'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector'
}

export const tunnelService = {
  list() {
    return api.get<TunnelInfo[]>('/tunnels')
  },

  create(dto: CreateTunnelDto) {
    return api.post<TunnelInfo>('/tunnels', dto)
  },

  testTarget(dto: TestTunnelTargetDto) {
    return api.post<TunnelTargetTestResult>('/tunnels/test', dto)
  },

  close(id: string) {
    return api.delete(`/tunnels/${id}`)
  },
}
