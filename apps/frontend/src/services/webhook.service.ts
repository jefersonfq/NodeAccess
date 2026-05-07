import type {
  WebhookSubscriptionPublic,
  WebhookDeliveryPublic,
  WebhookDeliveryStatus,
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
  WebhookTestResult,
} from '@nodeaccess/shared'
import api from './api'

export const webhookService = {
  listSubscriptions() {
    return api.get<WebhookSubscriptionPublic[]>('/webhooks/subscriptions')
  },

  createSubscription(dto: CreateWebhookSubscriptionDto) {
    return api.post<WebhookSubscriptionPublic>('/webhooks/subscriptions', dto)
  },

  updateSubscription(id: number, dto: UpdateWebhookSubscriptionDto) {
    return api.patch<WebhookSubscriptionPublic>(`/webhooks/subscriptions/${id}`, dto)
  },

  pauseSubscription(id: number) {
    return api.post(`/webhooks/subscriptions/${id}/pause`)
  },

  activateSubscription(id: number) {
    return api.post(`/webhooks/subscriptions/${id}/activate`)
  },

  rotateSecret(id: number) {
    return api.post<{ secret: string }>(`/webhooks/subscriptions/${id}/rotate-secret`)
  },

  deleteSubscription(id: number) {
    return api.delete(`/webhooks/subscriptions/${id}`)
  },

  listDeliveries(subscriptionId: number, status?: WebhookDeliveryStatus) {
    return api.get<WebhookDeliveryPublic[]>(
      `/webhooks/subscriptions/${subscriptionId}/deliveries`,
      { params: status ? { status } : {} },
    )
  },

  retryDelivery(subscriptionId: number, deliveryId: number) {
    return api.post(`/webhooks/subscriptions/${subscriptionId}/deliveries/${deliveryId}/retry`)
  },

  testDelivery(subscriptionId: number) {
    return api.post<WebhookTestResult>(`/webhooks/subscriptions/${subscriptionId}/test`)
  },
}
