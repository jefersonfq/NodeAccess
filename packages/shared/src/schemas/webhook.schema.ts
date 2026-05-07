import { z } from 'zod'

export const WebhookSubscriptionStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'FAILED'])
export const WebhookDeliveryStatusSchema      = z.enum(['PENDING', 'PROCESSING', 'DELIVERED', 'RETRY_SCHEDULED', 'DEAD'])
export const WebhookPayloadModeSchema         = z.enum(['AUTOMATIC', 'CUSTOM'])

export const WEBHOOK_EVENT_TYPES = [
  'action_run.created',
  'action_run.approved',
  'action_run.completed',
  'action_run.failed',
  'host.created',
  'host.updated',
  'host.deleted',
  'user.created',
  'user.activated',
  'user.deactivated',
  'mcp_token.created',
  'mcp_token.revoked',
  'mcp_interactive_ssh_session.opened',
  'mcp_interactive_ssh_session.closed',
  'diagnostic_run.completed',
  'diagnostic_run.failed',
  'ssh_session.started',
  'ssh_session.ended',
  'port_forwarding.created',
  'port_forwarding.deleted',
] as const

export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES)

export const CreateWebhookSubscriptionSchema = z.object({
  name:                z.string().min(1).max(120),
  description:         z.string().max(500).optional(),
  targetUrl:           z.string().url().max(2048),
  httpMethod:          z.enum(['POST', 'PUT']).default('POST'),
  subscribedEvents:    z.array(WebhookEventTypeSchema).min(1),
  secret:              z.string().min(8).max(256).optional(),
  timeoutMs:           z.number().int().min(1000).max(30000).default(5000),
  maxRetries:          z.number().int().min(0).max(10).default(5),
  payloadMode:         WebhookPayloadModeSchema.default('AUTOMATIC'),
  payloadTemplateJson: z.string().optional(),
  payloadSchemaJson:   z.string().optional(),
})

export const UpdateWebhookSubscriptionSchema = CreateWebhookSubscriptionSchema.partial()

export const WebhookSubscriptionPublicSchema = z.object({
  id:              z.number(),
  tenantId:        z.number(),
  name:            z.string(),
  description:     z.string().nullable(),
  targetUrl:       z.string(),
  httpMethod:      z.string(),
  status:          WebhookSubscriptionStatusSchema,
  subscribedEvents:z.array(z.string()),
  hasSecret:       z.boolean(),
  timeoutMs:       z.number(),
  maxRetries:      z.number(),
  payloadMode:     WebhookPayloadModeSchema,
  lastTriggeredAt: z.coerce.date().nullable(),
  lastSuccessAt:   z.coerce.date().nullable(),
  lastFailureAt:   z.coerce.date().nullable(),
  createdByUserId: z.number(),
  createdAt:       z.coerce.date(),
  updatedAt:       z.coerce.date(),
})

export const WebhookDeliveryPublicSchema = z.object({
  id:                  z.number(),
  subscriptionId:      z.number(),
  tenantId:            z.number(),
  eventId:             z.string(),
  eventType:           z.string(),
  eventVersion:        z.number(),
  resourceType:        z.string(),
  resourceId:          z.string(),
  status:              WebhookDeliveryStatusSchema,
  attemptCount:        z.number(),
  nextAttemptAt:       z.coerce.date().nullable(),
  lastAttemptAt:       z.coerce.date().nullable(),
  responseStatus:      z.number().nullable(),
  responseLatencyMs:   z.number().nullable(),
  responseBodySnippet: z.string().nullable(),
  lastErrorCode:       z.string().nullable(),
  lastErrorMessage:    z.string().nullable(),
  createdAt:           z.coerce.date(),
  updatedAt:           z.coerce.date(),
})

export const WebhookTestResultSchema = z.object({
  ok:        z.boolean(),
  status:    z.number().nullable(),
  latencyMs: z.number(),
  snippet:   z.string().nullable(),
  error:     z.string().nullable(),
})

export type WebhookSubscriptionStatus    = z.infer<typeof WebhookSubscriptionStatusSchema>
export type WebhookDeliveryStatus        = z.infer<typeof WebhookDeliveryStatusSchema>
export type WebhookPayloadMode           = z.infer<typeof WebhookPayloadModeSchema>
export type WebhookEventType             = z.infer<typeof WebhookEventTypeSchema>
export type CreateWebhookSubscriptionDto = z.infer<typeof CreateWebhookSubscriptionSchema>
export type UpdateWebhookSubscriptionDto = z.infer<typeof UpdateWebhookSubscriptionSchema>
export type WebhookSubscriptionPublic    = z.infer<typeof WebhookSubscriptionPublicSchema>
export type WebhookDeliveryPublic        = z.infer<typeof WebhookDeliveryPublicSchema>
export type WebhookTestResult            = z.infer<typeof WebhookTestResultSchema>
