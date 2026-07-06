import type {
  CreateInboundWebhookEndpointDto,
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

  pauseEndpoint(id: number) {
    return api.post(`/inbound-webhooks/endpoints/${id}/pause`)
  },

  activateEndpoint(id: number) {
    return api.post(`/inbound-webhooks/endpoints/${id}/activate`)
  },

  revokeEndpoint(id: number) {
    return api.post(`/inbound-webhooks/endpoints/${id}/revoke`)
  },

  listReceipts(endpointId: number, status?: InboundWebhookReceiptStatus) {
    return api.get<InboundWebhookReceiptPublic[]>(
      `/inbound-webhooks/endpoints/${endpointId}/receipts`,
      { params: status ? { status } : {} },
    )
  },
}
