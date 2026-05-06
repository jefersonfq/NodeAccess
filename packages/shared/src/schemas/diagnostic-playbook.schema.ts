import { z } from 'zod'

export const DiagnosticPlaybookCategorySchema = z.enum([
  'network',
  'compute',
  'storage',
  'kernel',
  'mysql',
  'agent',
])

export const DiagnosticPlaybookRiskLevelSchema = z.enum([
  'low',
  'medium',
  'high',
])

export const DiagnosticPlaybookTargetOsSchema = z.enum([
  'linux',
  'windows',
  'any',
])

export const DiagnosticRunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'canceled',
])

export const DiagnosticCommandStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
])

export const DiagnosticPlaybookCommandPreviewSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  command: z.string().min(1).max(2000),
  timeoutSeconds: z.number().int().min(1).max(300),
})

export const DiagnosticPlaybookPublicSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  category: DiagnosticPlaybookCategorySchema,
  riskLevel: DiagnosticPlaybookRiskLevelSchema,
  targetOs: DiagnosticPlaybookTargetOsSchema,
  requiresApproval: z.boolean(),
  enabled: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  lastUpdatedByName: z.string().nullable().optional(),
  commands: z.array(DiagnosticPlaybookCommandPreviewSchema).max(20),
})

export const CreateDiagnosticPlaybookSchema = z.object({
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  category: DiagnosticPlaybookCategorySchema,
  riskLevel: DiagnosticPlaybookRiskLevelSchema,
  targetOs: DiagnosticPlaybookTargetOsSchema,
  requiresApproval: z.boolean(),
  enabled: z.boolean(),
  commands: z.array(DiagnosticPlaybookCommandPreviewSchema).min(1).max(20),
})

export const UpdateDiagnosticPlaybookSchema = CreateDiagnosticPlaybookSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Informe ao menos um campo para atualizar o playbook',
)

export const CreateDiagnosticRunSchema = z.object({
  playbookId: z.number().int().positive(),
})

export const DiagnosticRunAiSummarySchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']),
  confidence: z.enum(['low', 'medium', 'high']),
  keyFindings: z.array(z.string()).max(10),
  nextActions: z.array(z.string()).max(10),
})

export const DiagnosticRunCommandSchema = z.object({
  id: z.number().int().positive(),
  commandId: z.string().min(1).max(80),
  command: z.string().min(1),
  status: DiagnosticCommandStatusSchema,
  exitCode: z.number().int().nullable(),
  outputPreview: z.string().nullable(),
  outputBody: z.string().nullable(),
  redactionApplied: z.boolean(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
})

export const DiagnosticRunPublicSchema = z.object({
  id: z.number().int().positive(),
  hostId: z.number().int().positive(),
  playbookId: z.number().int().positive(),
  playbookName: z.string().min(1).max(120),
  status: DiagnosticRunStatusSchema,
  requestedById: z.number().int().positive(),
  approvedById: z.number().int().positive().nullable(),
  triggerSource: z.string().min(1).max(30),
  errorMessage: z.string().nullable(),
  aiSummaryStatus: z.string().nullable(),
  aiSummaryText: z.string().nullable(),
  aiSummaryStructured: DiagnosticRunAiSummarySchema.nullable().optional(),
  startedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const DiagnosticRunDetailSchema = DiagnosticRunPublicSchema.extend({
  commands: z.array(DiagnosticRunCommandSchema),
})

export type DiagnosticPlaybookCategory = z.infer<typeof DiagnosticPlaybookCategorySchema>
export type DiagnosticPlaybookRiskLevel = z.infer<typeof DiagnosticPlaybookRiskLevelSchema>
export type DiagnosticPlaybookTargetOs = z.infer<typeof DiagnosticPlaybookTargetOsSchema>
export type DiagnosticRunStatus = z.infer<typeof DiagnosticRunStatusSchema>
export type DiagnosticCommandStatus = z.infer<typeof DiagnosticCommandStatusSchema>
export type DiagnosticPlaybookCommandPreview = z.infer<typeof DiagnosticPlaybookCommandPreviewSchema>
export type DiagnosticPlaybookPublic = z.infer<typeof DiagnosticPlaybookPublicSchema>
export type CreateDiagnosticPlaybookDto = z.infer<typeof CreateDiagnosticPlaybookSchema>
export type UpdateDiagnosticPlaybookDto = z.infer<typeof UpdateDiagnosticPlaybookSchema>
export type CreateDiagnosticRunDto = z.infer<typeof CreateDiagnosticRunSchema>
export type DiagnosticRunAiSummary = z.infer<typeof DiagnosticRunAiSummarySchema>
export type DiagnosticRunCommand = z.infer<typeof DiagnosticRunCommandSchema>
export type DiagnosticRunPublic = z.infer<typeof DiagnosticRunPublicSchema>
export type DiagnosticRunDetail = z.infer<typeof DiagnosticRunDetailSchema>
