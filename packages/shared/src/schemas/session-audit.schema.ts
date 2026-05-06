import { z } from 'zod'

export const SessionAuditStatusSchema = z.enum([
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'PURGED',
])

export const AiArtifactStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED',
])

export const SessionAuditAiJobKindSchema = z.enum([
  'SUMMARY',
])

export const SessionAuditAiJobStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED',
  'CANCELED',
])

export const SessionAuditAiTriggerSourceSchema = z.enum([
  'AUTO_POST_SESSION',
  'MANUAL',
  'WINDOW',
])

export const SessionAuditAiPromptTemplateSchema = z.enum([
  'summary-v1',
  'cab-v1',
  'risk-v1',
])

export const SessionAuditAiSummaryStructuredSchema = z.object({
  summary: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  keyFindings: z.array(z.string()),
  nextActions: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
})

export const SessionAuditEventTypeSchema = z.enum([
  'session_started',
  'stdin',
  'stdout',
  'resize',
  'session_error',
  'session_ended',
])

export const SessionAuditSharedParticipantSchema = z.object({
  userId: z.number().int().positive(),
  name: z.string(),
  email: z.string().email().nullable(),
  role: z.enum(['owner', 'viewer']),
  joinedAt: z.coerce.date(),
  leftAt: z.coerce.date().nullable(),
})

export const SessionAuditControlEpochSchema = z.object({
  leaseId: z.number().int().positive(),
  controllerUserId: z.number().int().positive(),
  controllerName: z.string(),
  grantedByUserId: z.number().int().positive(),
  grantedByName: z.string(),
  startedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  endReason: z.enum(['revoked', 'expired', 'session_ended', 'owner_disconnected', 'relinquished']).nullable(),
  revokeReason: z.string().nullable(),
})

export const SessionAuditSharedContextSchema = z.object({
  sharedSessionId: z.number().int().positive(),
  status: z.enum(['active', 'ended', 'revoked']),
  ownerUserId: z.number().int().positive(),
  ownerName: z.string(),
  participantsCount: z.number().int().nonnegative(),
  participants: z.array(SessionAuditSharedParticipantSchema),
  controlEpochs: z.array(SessionAuditControlEpochSchema),
})

export const SessionAuditCriticalEventSchema = z.object({
  type: z.enum([
    'destructive_delete',
    'service_start',
    'service_stop',
    'service_restart',
    'service_status',
    'permission_change',
    'identity_change',
    'package_change',
    'config_edit',
  ]),
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string(),
  summary: z.string(),
  commandIndex: z.number().int().positive(),
  command: z.string(),
  evidence: z.array(z.string()),
})

export const SessionAuditPublicSchema = z.object({
  sessionId: z.number(),
  tenantId: z.number(),
  userId: z.number(),
  userNameSnapshot: z.string(),
  userEmailSnapshot: z.string().nullable(),
  hostId: z.number(),
  hostNameSnapshot: z.string(),
  hostIpSnapshot: z.string(),
  hostDeleted: z.boolean().default(false),
  hostDeletedAt: z.coerce.date().nullable().optional(),
  connectionMethod: z.string(),
  clientIp: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  agentRemoteIp: z.string().nullable().optional(),
  ticketProvider: z.string().nullable(),
  ticketKey: z.string().nullable(),
  ticketUrl: z.string().nullable(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  status: SessionAuditStatusSchema,
  chunkCount: z.number(),
  bytesIn: z.coerce.number().nonnegative(),
  bytesOut: z.coerce.number().nonnegative(),
  aiSummaryStatus: AiArtifactStatusSchema,
  aiSummaryText: z.string().nullable(),
  aiRiskLevel: z.string().nullable(),
  aiSummaryStructured: SessionAuditAiSummaryStructuredSchema.nullable(),
  criticalEvents: z.array(SessionAuditCriticalEventSchema).default([]),
  sharedSessionContext: SessionAuditSharedContextSchema.nullable().optional(),
})

export const SessionAuditEventSchema = z.object({
  version: z.literal(1),
  eventId: z.string(),
  sessionId: z.number(),
  tenantId: z.number(),
  userId: z.number(),
  hostId: z.number(),
  seq: z.number().int().nonnegative(),
  timestamp: z.string(),
  type: SessionAuditEventTypeSchema,
  source: z.literal('gateway'),
  payload: z.record(z.unknown()),
})

export const SessionAuditPreviewEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  timestamp: z.string(),
  type: SessionAuditEventTypeSchema,
  text: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  cols: z.number().int().positive().nullable(),
  rows: z.number().int().positive().nullable(),
})

export const SessionAuditCommandSchema = z.object({
  index: z.number().int().positive(),
  command: z.string(),
  submittedAt: z.string(),
  output: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
})

export const SessionAuditAiJobPublicSchema = z.object({
  id: z.number(),
  sessionId: z.number(),
  tenantId: z.number(),
  requestedByUserId: z.number().nullable(),
  kind: SessionAuditAiJobKindSchema,
  triggerSource: SessionAuditAiTriggerSourceSchema,
  provider: z.string(),
  model: z.string().nullable(),
  status: SessionAuditAiJobStatusSchema,
  promptVersion: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const SessionAuditAiArtifactPublicSchema = z.object({
  id: z.number(),
  sessionId: z.number(),
  jobId: z.number(),
  triggerSource: SessionAuditAiTriggerSourceSchema,
  template: z.string(),
  summaryText: z.string(),
  summaryStructured: SessionAuditAiSummaryStructuredSchema.nullable(),
  riskLevel: z.string().nullable(),
  createdAt: z.coerce.date(),
})

export const SessionAuditRetrySummarySchema = z.object({
  template: SessionAuditAiPromptTemplateSchema.default('summary-v1'),
})

export const SessionAuditLinkTicketSchema = z.object({
  ticketKey: z.string().min(1),
})

export type SessionAuditStatus = z.infer<typeof SessionAuditStatusSchema>
export type AiArtifactStatus = z.infer<typeof AiArtifactStatusSchema>
export type SessionAuditAiJobKind = z.infer<typeof SessionAuditAiJobKindSchema>
export type SessionAuditAiJobStatus = z.infer<typeof SessionAuditAiJobStatusSchema>
export type SessionAuditAiTriggerSource = z.infer<typeof SessionAuditAiTriggerSourceSchema>
export type SessionAuditAiPromptTemplate = z.infer<typeof SessionAuditAiPromptTemplateSchema>
export type SessionAuditAiSummaryStructured = z.infer<typeof SessionAuditAiSummaryStructuredSchema>
export type SessionAuditEventType = z.infer<typeof SessionAuditEventTypeSchema>
export type SessionAuditSharedParticipant = z.infer<typeof SessionAuditSharedParticipantSchema>
export type SessionAuditControlEpoch = z.infer<typeof SessionAuditControlEpochSchema>
export type SessionAuditSharedContext = z.infer<typeof SessionAuditSharedContextSchema>
export type SessionAuditCriticalEvent = z.infer<typeof SessionAuditCriticalEventSchema>
export type SessionAuditPublic = z.infer<typeof SessionAuditPublicSchema>
export type SessionAuditEvent = z.infer<typeof SessionAuditEventSchema>
export type SessionAuditPreviewEvent = z.infer<typeof SessionAuditPreviewEventSchema>
export type SessionAuditCommand = z.infer<typeof SessionAuditCommandSchema>
export type SessionAuditAiJobPublic = z.infer<typeof SessionAuditAiJobPublicSchema>
export type SessionAuditAiArtifactPublic = z.infer<typeof SessionAuditAiArtifactPublicSchema>
export type SessionAuditRetrySummaryDto = z.infer<typeof SessionAuditRetrySummarySchema>
export type SessionAuditLinkTicketDto = z.infer<typeof SessionAuditLinkTicketSchema>
