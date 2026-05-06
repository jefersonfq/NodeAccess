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
})

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
})

export const AiSshActionRunDetailSchema = AiSshActionRunPublicSchema.extend({
  steps: z.array(AiSshActionRunStepSchema),
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
