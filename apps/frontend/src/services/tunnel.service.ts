import api from './api'

export interface TunnelInfo {
  id:         string
  hostId:     number
  hostName:   string
  connectionMethod: 'direct' | 'agent'
  bindAddress: '127.0.0.1' | '0.0.0.0'
  localPort:  number
  requestedLocalPort: number
  assignedLocalPort: number
  usedPortFallback: boolean
  remoteHost: string
  remotePort: number
  createdAt:  string
}

export interface CreateTunnelDto {
  hostId:     number
  localPort:  number
  remoteHost: string
  remotePort: number
}

export const tunnelService = {
  list() {
    return api.get<TunnelInfo[]>('/tunnels')
  },

  create(dto: CreateTunnelDto) {
    return api.post<TunnelInfo>('/tunnels', dto)
  },

  close(id: string) {
    return api.delete(`/tunnels/${id}`)
  },
}
