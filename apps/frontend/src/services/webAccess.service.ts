import api from './api'

export interface WebAccessLinkResponse {
  url: string
  expiresIn: string
  assignedLocalPort: number
  requestedLocalPort: number
  usedPortFallback: boolean
}

export const webAccessService = {
  createLink: (forwardingId: number) =>
    api.post<WebAccessLinkResponse>(`/web-access/${forwardingId}/link`),
}
