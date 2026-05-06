import type { WebhookEventType } from '@nodeaccess/shared'

export interface WebhookDomainEvent {
  tenantId:     number
  eventType:    WebhookEventType
  eventVersion: number
  resourceType: string
  resourceId:   string
  occurredAt:   Date
  correlationId?: string
  data:         Record<string, unknown>
}
