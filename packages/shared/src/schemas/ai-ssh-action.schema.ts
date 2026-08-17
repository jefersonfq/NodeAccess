import { z } from 'zod'

export const AiSshActionModeSchema = z.enum([
  'read_only',
  'diagnostic_only',
  'approval_required',
  'full_operational_access',
])

export const AiSshActionStatusSchema = z.enum([
  'pending_approval',
  'approved',
  'running',
  'completed',
  'failed',
  'canceled',
  'rejected',
])

export const AiSshActionStepStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
])

export const AiSshActionChannelSchema = z.enum([
  'local_ai',
  'mcp',
  'integration',
  'internal',
])

export const AiSshActionRequestedStepSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  command: z.string().min(1).max(4000),
  timeoutSeconds: z.number().int().min(1).max(900),
})

export const CreateAiSshActionRunSchema = z.object({
  hostId: z.number().int().positive(),
  mode: AiSshActionModeSchema,
  channel: AiSshActionChannelSchema,
  summary: z.string().min(1).max(500),
  approvalReason: z.string().max(500).nullable().optional(),
  steps: z.array(AiSshActionRequestedStepSchema).min(1).max(25),
  scriptArtifactId: z.number().int().positive().nullable().optional(),
})

export const CreateAiScriptArtifactSchema = z.object({
  hostId: z.number().int().positive(),
  title: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(500),
  content: z.string().min(1).max(100000),
  interactionCorrelationId: z.string().uuid().nullable().optional(),
})

export const AiScriptArtifactSchema = z.object({
  id: z.number().int().positive(), tenantId: z.number().int().positive(), hostId: z.number().int().positive(),
  createdById: z.number().int().positive(), actionRunId: z.number().int().positive().nullable(),
  interactionCorrelationId: z.string().uuid().nullable(),
  title: z.string(), objective: z.string(), destination: z.string(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['draft', 'pending_approval', 'approved', 'executed', 'failed', 'rejected']),
  risk: z.enum(['safe', 'approval_required', 'blocked']),
  createdAt: z.coerce.date(), updatedAt: z.coerce.date(),
})

export const AiScriptArtifactDetailSchema = AiScriptArtifactSchema.extend({ content: z.string() })

export const AiSshActionRunStepSchema = z.object({
  id: z.number().int().positive(),
  stepId: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  command: z.string().min(1),
  timeoutSeconds: z.number().int().min(1).max(900),
  status: AiSshActionStepStatusSchema,
  exitCode: z.number().int().nullable(),
  outputPreview: z.string().nullable(),
  redactionApplied: z.boolean(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
})

export const AiSshActionRunPublicSchema = z.object({
  id: z.number().int().positive(),
  tenantId: z.number().int().positive(),
  hostId: z.number().int().positive(),
  requestedById: z.number().int().positive(),
  approvedById: z.number().int().positive().nullable(),
  channel: AiSshActionChannelSchema,
  mode: AiSshActionModeSchema,
  status: AiSshActionStatusSchema,
  summary: z.string().min(1).max(500),
  approvalReason: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  scriptArtifactId: z.number().int().positive().nullable(),
  mcpTokenId: z.number().int().positive().nullable().optional(),
  investigationId: z.number().int().positive().nullable().optional(),
})

export const AiSshActionRunDetailSchema = AiSshActionRunPublicSchema.extend({
  steps: z.array(AiSshActionRunStepSchema),
})

export const AiSshActionRunReportSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  runId: z.number().int().positive(),
  hostId: z.number().int().positive(),
  status: AiSshActionStatusSchema,
  mode: AiSshActionModeSchema,
  channel: AiSshActionChannelSchema,
  summary: z.string(),
  assessment: z.enum(['successful', 'partial', 'failed', 'incomplete']),
  evidence: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    redacted: z.number().int().nonnegative(),
    steps: z.array(z.object({
      stepId: z.string(),
      label: z.string(),
      command: z.string(),
      status: AiSshActionStepStatusSchema,
      exitCode: z.number().int().nullable(),
      outputPreview: z.string().nullable(),
      redactionApplied: z.boolean(),
    })),
  }),
  integrity: z.object({ algorithm: z.literal('sha256'), checksum: z.string().regex(/^[a-f0-9]{64}$/) }),
})

export type AiSshActionMode = z.infer<typeof AiSshActionModeSchema>
export type AiSshActionStatus = z.infer<typeof AiSshActionStatusSchema>
export type AiSshActionStepStatus = z.infer<typeof AiSshActionStepStatusSchema>
export type AiSshActionChannel = z.infer<typeof AiSshActionChannelSchema>
export type AiSshActionRequestedStep = z.infer<typeof AiSshActionRequestedStepSchema>
export type CreateAiSshActionRunDto = z.infer<typeof CreateAiSshActionRunSchema>
export type AiSshActionRunStep = z.infer<typeof AiSshActionRunStepSchema>
export type AiSshActionRunPublic = z.infer<typeof AiSshActionRunPublicSchema>
export type AiSshActionRunDetail = z.infer<typeof AiSshActionRunDetailSchema>
export type AiSshActionRunReport = z.infer<typeof AiSshActionRunReportSchema>
export type CreateAiScriptArtifactDto = z.infer<typeof CreateAiScriptArtifactSchema>
export type AiScriptArtifact = z.infer<typeof AiScriptArtifactSchema>
export type AiScriptArtifactDetail = z.infer<typeof AiScriptArtifactDetailSchema>
