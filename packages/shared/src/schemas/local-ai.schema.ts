import { z } from 'zod'
import { LocalAiModeSchema, LocalAiRoutingPolicySchema } from './integration.schema.js'
import { AiSshActionModeSchema } from './ai-ssh-action.schema.js'

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
    circuitState: z.enum(['closed', 'open']).optional(),
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
  correlationId: z.string().uuid().nullable().optional(),
  answer: z.string(),
  provider: LocalAiProviderSchema,
  mode: LocalAiModeSchema,
  actionExecutionEnabled: z.boolean(),
  guardrailMessage: z.string().nullable(),
  citations: z.array(LocalAiCitationSchema),
  toolExecutions: z.array(z.object({
    key: z.string(),
    status: z.enum(['executed', 'failed']),
    durationMs: z.number().int().nonnegative(),
  })).optional(),
})

export const LocalAiDiagnosticPlanRequestSchema = z.object({
  hostId: z.number().int().positive(),
  objective: z.string().min(10).max(1000),
})

export const LocalAiDiagnosticPlanSchema = z.object({
  correlationId: z.string().uuid().nullable().optional(),
  hostId: z.number().int().positive(),
  hostName: z.string(),
  objective: z.string(),
  summary: z.string().min(1).max(500),
  provider: LocalAiProviderSchema,
  recommendedMode: AiSshActionModeSchema,
  executable: z.boolean(),
  warnings: z.array(z.string()),
  steps: z.array(z.object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(160),
    command: z.string().min(1).max(4000),
    timeoutSeconds: z.number().int().min(1).max(300),
    risk: z.enum(['safe', 'approval_required', 'blocked']),
  })).min(1).max(8),
})

export const LocalAiTerminalAssistRequestSchema = z.object({
  hostId: z.number().int().positive(),
  instruction: z.string().trim().min(3).max(1000),
  intent: z.enum(['explain', 'command', 'script']),
  terminalContext: LocalAiChatRequestSchema.shape.terminalContext,
})

export const LocalAiTerminalAssistSchema = z.object({
  correlationId: z.string().uuid().nullable().optional(),
  kind: z.enum(['explanation', 'command', 'script']),
  title: z.string().min(1).max(160),
  explanation: z.string().min(1).max(4000),
  content: z.string().max(12000),
  provider: LocalAiProviderSchema,
  risk: z.enum(['safe', 'approval_required', 'blocked', 'not_applicable']),
  canInsert: z.boolean(),
  requiresApproval: z.boolean(),
  warnings: z.array(z.string()),
})

export const LocalAiUsageProviderSchema = z.object({
  provider: LocalAiProviderSchema,
  model: z.string(),
  requests: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  circuitOpen: z.number().int().nonnegative(),
  rateLimited: z.number().int().nonnegative(),
  timeouts: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  averageLatencyMs: z.number().int().nonnegative(),
  estimatedUsdMicros: z.number().int().nonnegative().nullable(),
  priced: z.boolean(),
})

export const LocalAiUsageSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int().min(1).max(366),
  providers: z.array(LocalAiUsageProviderSchema),
  totals: z.object({
    requests: z.number().int().nonnegative(),
    successes: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedUsdMicros: z.number().int().nonnegative().nullable(),
    unpricedRequests: z.number().int().nonnegative(),
  }),
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

export const AiInteractionSchema = z.object({
  id: z.string(),
  correlationId: z.string().uuid(),
  channel: z.enum(['assistant', 'terminal', 'diagnostic', 'audit', 'mcp', 'api']),
  purpose: z.string(),
  provider: z.string(),
  model: z.string(),
  routingPolicy: z.string(),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  hostId: z.number().int().positive().nullable(),
  sessionId: z.number().int().positive().nullable(),
  ticketKey: z.string().nullable(),
  contextCategories: z.array(z.string()),
  contextChars: z.number().int().nonnegative(),
  tools: z.array(z.string()),
  redactionCount: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  errorKind: z.string().nullable(),
  estimatedUsdMicros: z.number().int().nonnegative().nullable(),
  scriptArtifactId: z.number().int().positive().nullable(),
  actionRunId: z.number().int().positive().nullable(),
  retentionUntil: z.string(),
  createdAt: z.string(),
})

export const AiInteractionListSchema = z.object({
  items: z.array(AiInteractionSchema),
  retentionDays: z.number().int().positive(),
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
export type LocalAiDiagnosticPlanRequest = z.infer<typeof LocalAiDiagnosticPlanRequestSchema>
export type LocalAiDiagnosticPlan = z.infer<typeof LocalAiDiagnosticPlanSchema>
export type LocalAiTerminalAssistRequest = z.infer<typeof LocalAiTerminalAssistRequestSchema>
export type LocalAiTerminalAssist = z.infer<typeof LocalAiTerminalAssistSchema>
export type LocalAiUsageProvider = z.infer<typeof LocalAiUsageProviderSchema>
export type LocalAiUsageSummary = z.infer<typeof LocalAiUsageSummarySchema>
export type LocalAiKnowledgeSourceType = z.infer<typeof LocalAiKnowledgeSourceTypeSchema>
export type LocalAiKnowledgeStatus = z.infer<typeof LocalAiKnowledgeStatusSchema>
export type LocalAiKnowledgeDocument = z.infer<typeof LocalAiKnowledgeDocumentSchema>
export type LocalAiActivityItem = z.infer<typeof LocalAiActivityItemSchema>
export type AiInteraction = z.infer<typeof AiInteractionSchema>
export type AiInteractionList = z.infer<typeof AiInteractionListSchema>
export type CreateLocalAiKnowledgeTextDocumentDto = z.infer<typeof CreateLocalAiKnowledgeTextDocumentSchema>
export type CreateLocalAiKnowledgeLinkDocumentDto = z.infer<typeof CreateLocalAiKnowledgeLinkDocumentSchema>
