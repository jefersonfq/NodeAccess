import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

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
  hostConnectionMode: 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'PRIVATE_ACCESS_CONNECTOR' | 'AUTO'
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

const forwardingsListCache = createTimedPromiseCache<{ data: PortForwardingWithHost[] }>(cacheTtls.forwardingsList, { name: 'forwardings:list-all' })

export const portForwardingService = {
  listAll: () =>
    forwardingsListCache.get(() => api.get<PortForwardingWithHost[]>('/forwardings')),

  list:   (hostId: number) =>
    api.get<PortForwarding[]>(`/forwardings/${hostId}`),

  create: (hostId: number, data: CreatePortForwardingDto) =>
    api.post<PortForwarding>(`/forwardings/${hostId}`, data).then((res) => {
      forwardingsListCache.clear('forwarding:create')
      return res
    }),

  update: (hostId: number, id: number, data: Partial<Omit<PortForwarding, 'id' | 'hostId' | 'createdAt'>>) =>
    api.patch<PortForwarding>(`/forwardings/${hostId}/${id}`, data).then((res) => {
      forwardingsListCache.clear('forwarding:update')
      return res
    }),

  remove: (hostId: number, id: number) =>
    api.delete(`/forwardings/${hostId}/${id}`).then((res) => {
      forwardingsListCache.clear('forwarding:remove')
      return res
    }),

  clear: (reason = 'manual-clear') => forwardingsListCache.clear(reason),
}
