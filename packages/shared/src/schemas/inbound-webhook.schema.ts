import { z } from 'zod'

export const InboundWebhookEndpointStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'REVOKED'])
export const InboundWebhookMappingModeSchema = z.enum(['GENERIC', 'PROVIDER_ADAPTER'])
export const InboundWebhookReceiptStatusSchema = z.enum([
  'RECEIVED',
  'ACCEPTED',
  'REJECTED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'IGNORED',
])

export const CreateInboundWebhookEndpointSchema = z.object({
  provider: z.string().min(2).max(60).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  secret: z.string().min(8).max(256).optional(),
  allowedEventTypes: z.array(z.string().min(1).max(120)).default([]),
  mappingMode: InboundWebhookMappingModeSchema.default('GENERIC'),
})

export const UpdateInboundWebhookEndpointSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  secret: z.string().min(8).max(256).nullable().optional(),
  allowedEventTypes: z.array(z.string().min(1).max(120)).optional(),
  mappingMode: InboundWebhookMappingModeSchema.optional(),
  status: InboundWebhookEndpointStatusSchema.optional(),
})

export const InboundWebhookEndpointPublicSchema = z.object({
  id: z.number(),
  tenantId: z.number(),
  provider: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: InboundWebhookEndpointStatusSchema,
  hasSecret: z.boolean(),
  allowedEventTypes: z.array(z.string()),
  mappingMode: InboundWebhookMappingModeSchema,
  createdByUserId: z.number(),
  updatedByUserId: z.number().nullable(),
  lastReceivedAt: z.coerce.date().nullable(),
  lastAcceptedAt: z.coerce.date().nullable(),
  lastRejectedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const InboundWebhookEndpointCreatedSchema = z.object({
  endpoint: InboundWebhookEndpointPublicSchema,
  endpointToken: z.string(),
})

export const InboundWebhookReceiptPublicSchema = z.object({
  id: z.number(),
  tenantId: z.number(),
  endpointId: z.number(),
  provider: z.string(),
  externalEventId: z.string().nullable(),
  eventType: z.string(),
  idempotencyKey: z.string().nullable(),
  status: InboundWebhookReceiptStatusSchema,
  receivedAt: z.coerce.date(),
  processedAt: z.coerce.date().nullable(),
  sourceIp: z.string().nullable(),
  signatureValid: z.boolean(),
  payloadHash: z.string(),
  normalizedEventJson: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  correlationId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const InboundWebhookIngestResultSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean(),
  receiptId: z.number().nullable(),
  status: InboundWebhookReceiptStatusSchema,
})

export type InboundWebhookEndpointStatus = z.infer<typeof InboundWebhookEndpointStatusSchema>
export type InboundWebhookMappingMode = z.infer<typeof InboundWebhookMappingModeSchema>
export type InboundWebhookReceiptStatus = z.infer<typeof InboundWebhookReceiptStatusSchema>
export type CreateInboundWebhookEndpointDto = z.infer<typeof CreateInboundWebhookEndpointSchema>
export type UpdateInboundWebhookEndpointDto = z.infer<typeof UpdateInboundWebhookEndpointSchema>
export type InboundWebhookEndpointPublic = z.infer<typeof InboundWebhookEndpointPublicSchema>
export type InboundWebhookEndpointCreated = z.infer<typeof InboundWebhookEndpointCreatedSchema>
export type InboundWebhookReceiptPublic = z.infer<typeof InboundWebhookReceiptPublicSchema>
export type InboundWebhookIngestResult = z.infer<typeof InboundWebhookIngestResultSchema>
