import type {
  CreateInboundWebhookEndpointDto,
  UpdateInboundWebhookEndpointDto,
  InboundWebhookEndpointCreated,
  InboundWebhookEndpointPublic,
  InboundWebhookReceiptPublic,
  InboundWebhookReceiptStatus,
} from '@nodeaccess/shared'
import api from './api'

export const inboundWebhookService = {
  listEndpoints() {
    return api.get<InboundWebhookEndpointPublic[]>('/inbound-webhooks/endpoints')
  },

  createEndpoint(dto: CreateInboundWebhookEndpointDto) {
    return api.post<InboundWebhookEndpointCreated>('/inbound-webhooks/endpoints', dto)
  },

  updateEndpoint(id: number, dto: UpdateInboundWebhookEndpointDto) {
    return api.patch<InboundWebhookEndpointPublic>(`/inbound-webhooks/endpoints/${id}`, dto)
  },
  rotateCredentials(id: number) {
    return api.post<{ endpointToken: string; secret: string }>(`/inbound-webhooks/endpoints/${id}/rotate-credentials`)
  },
  pauseEndpoint(id: number) {
    return api.post(`/inbound-webhooks/endpoints/${id}/pause`)
  },

  activateEndpoint(id: number) {
    return api.post(`/inbound-webhooks/endpoints/${id}/activate`)
  },

  revokeEndpoint(id: number) {
    return api.post(`/inbound-webhooks/endpoints/${id}/revoke`)
  },

  listReceipts(endpointId: number, status?: InboundWebhookReceiptStatus, beforeId?: number) {
    return api.get<InboundWebhookReceiptPublic[]>(
      `/inbound-webhooks/endpoints/${endpointId}/receipts`,
      { params: { status, beforeId, limit: 25 } },
    )
  },
}
