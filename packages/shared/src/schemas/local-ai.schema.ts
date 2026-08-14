import { z } from 'zod'
import { LocalAiModeSchema, LocalAiRoutingPolicySchema } from './integration.schema.js'

export const LocalAiProviderSchema = z.enum([
  'ollama',
  'openai_compatible',
])

export const LocalAiKnowledgeSourceTypeSchema = z.enum([
  'text',
  'link',
  'file',
])

export const LocalAiKnowledgeStatusSchema = z.enum([
  'ready',
  'failed',
])

export const LocalAiStatusSchema = z.object({
  available: z.boolean(),
  enabled: z.boolean(),
  mode: LocalAiModeSchema.nullable(),
  routingPolicy: LocalAiRoutingPolicySchema.nullable(),
  localConfigured: z.boolean(),
  networkConfigured: z.boolean(),
  effectiveProvider: LocalAiProviderSchema.nullable(),
  providerStates: z.array(z.object({
    key: LocalAiProviderSchema,
    locality: z.enum(['local', 'network']),
    configured: z.boolean(),
    selected: z.boolean(),
    model: z.string().nullable(),
  })).optional(),
  routingExplanation: z.string().nullable().optional(),
  runtimeFailoverEnabled: z.boolean().optional(),
  actionExecutionEnabled: z.boolean(),
  guardrailMessage: z.string().nullable(),
  message: z.string().nullable(),
})

export const LocalAiChatRequestSchema = z.object({
  message: z.string().min(3).max(4000),
  contextRoute: z.string().max(1000).nullable().optional(),
  contextScreen: z.string().max(200).nullable().optional(),
  terminalContext: z.object({
    sessionId: z.number().int().positive().nullable().optional(),
    hostId: z.number().int().positive().nullable().optional(),
    hostName: z.string().max(200).nullable().optional(),
    hostIp: z.string().max(120).nullable().optional(),
    connectionStatus: z.string().max(50).nullable().optional(),
    selection: z.string().max(12000).nullable().optional(),
    recentOutput: z.string().max(24000).nullable().optional(),
    bufferTail: z.string().max(80000).nullable().optional(),
  }).nullable().optional(),
})

export const LocalAiCitationSchema = z.object({
  kind: z.enum(['settings', 'tenant', 'hosts', 'sessions', 'documents']),
  label: z.string(),
})

export const LocalAiChatResponseSchema = z.object({
  answer: z.string(),
  provider: LocalAiProviderSchema,
  mode: LocalAiModeSchema,
  actionExecutionEnabled: z.boolean(),
  guardrailMessage: z.string().nullable(),
  citations: z.array(LocalAiCitationSchema),
})

export const LocalAiKnowledgeDocumentSchema = z.object({
  id: z.number().int().positive(),
  sourceType: LocalAiKnowledgeSourceTypeSchema,
  status: LocalAiKnowledgeStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  referenceUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  byteSize: z.number().int().nullable(),
  hasContent: z.boolean(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    email: z.string(),
  }),
})

export const LocalAiActivityItemSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(['TEST_LOCAL_AI', 'OPEN_LOCAL_AI_DIAGNOSTIC']),
  adminName: z.string(),
  timestamp: z.string(),
  details: z.string().nullable().optional(),
})

export const CreateLocalAiKnowledgeTextDocumentSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().max(5000).nullable().optional(),
  contentText: z.string().min(10).max(100000),
})

export const CreateLocalAiKnowledgeLinkDocumentSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().max(5000).nullable().optional(),
  referenceUrl: z.string().url().max(2000),
  contentText: z.string().max(100000).nullable().optional(),
})

export type LocalAiStatus = z.infer<typeof LocalAiStatusSchema>
export type LocalAiChatRequest = z.infer<typeof LocalAiChatRequestSchema>
export type LocalAiCitation = z.infer<typeof LocalAiCitationSchema>
export type LocalAiChatResponse = z.infer<typeof LocalAiChatResponseSchema>
export type LocalAiKnowledgeSourceType = z.infer<typeof LocalAiKnowledgeSourceTypeSchema>
export type LocalAiKnowledgeStatus = z.infer<typeof LocalAiKnowledgeStatusSchema>
export type LocalAiKnowledgeDocument = z.infer<typeof LocalAiKnowledgeDocumentSchema>
export type LocalAiActivityItem = z.infer<typeof LocalAiActivityItemSchema>
export type CreateLocalAiKnowledgeTextDocumentDto = z.infer<typeof CreateLocalAiKnowledgeTextDocumentSchema>
export type CreateLocalAiKnowledgeLinkDocumentDto = z.infer<typeof CreateLocalAiKnowledgeLinkDocumentSchema>
