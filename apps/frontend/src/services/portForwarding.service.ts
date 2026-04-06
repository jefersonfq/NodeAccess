import api from './api'

export interface PortForwarding {
  id:          number
  hostId:      number
  description: string | null
  bindAddress: '127.0.0.1' | '0.0.0.0'
  webEnabled:  boolean
  webProtocol: 'http' | 'https'
  localPort:   number
  remoteHost:  string
  remotePort:  number
  autoStart:   boolean
  createdAt:   string
}

export interface PortForwardingWithHost extends PortForwarding {
  hostName: string
  hostIp:   string
  hostConnectionMode: 'DIRECT' | 'AGENT'
}

export interface CreatePortForwardingDto {
  description?: string
  bindAddress?: '127.0.0.1' | '0.0.0.0'
  webEnabled?:  boolean
  webProtocol?: 'http' | 'https'
  localPort:    number
  remoteHost:   string
  remotePort:   number
  autoStart?:   boolean
}

export const portForwardingService = {
  listAll: () =>
    api.get<PortForwardingWithHost[]>('/forwardings'),

  list:   (hostId: number) =>
    api.get<PortForwarding[]>(`/forwardings/${hostId}`),

  create: (hostId: number, data: CreatePortForwardingDto) =>
    api.post<PortForwarding>(`/forwardings/${hostId}`, data),

  update: (hostId: number, id: number, data: Partial<Omit<PortForwarding, 'id' | 'hostId' | 'createdAt'>>) =>
    api.patch<PortForwarding>(`/forwardings/${hostId}/${id}`, data),

  remove: (hostId: number, id: number) =>
    api.delete(`/forwardings/${hostId}/${id}`),
}
