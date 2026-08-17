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

export const UpdateDiagnosticRunTraceabilitySchema = z.object({
  sessionId: z.number().int().positive().nullable().optional(),
  ticketKey: z.string().trim().min(1).max(100).nullable().optional(),
  actionRunId: z.number().int().positive().nullable().optional(),
})

export const PublishDiagnosticRunReportToJiraSchema = z.object({
  reportUrl: z.string().url().max(2000),
  includeAttachment: z.boolean().default(false),
})

export const PublishDiagnosticRunReportToJiraResultSchema = z.object({
  ticketKey: z.string(),
  checksum: z.string(),
  queuedActions: z.array(z.enum(['COMMENT_DIAGNOSTIC_REPORT', 'ATTACH_DIAGNOSTIC_REPORT'])),
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
  hostName: z.string().nullable().optional(),
  hostIp: z.string().nullable().optional(),
  playbookId: z.number().int().positive(),
  playbookName: z.string().min(1).max(120),
  status: DiagnosticRunStatusSchema,
  requestedById: z.number().int().positive(),
  approvedById: z.number().int().positive().nullable(),
  triggerSource: z.string().min(1).max(30),
  originSessionId: z.number().int().positive().nullable().optional(),
  originTicketKey: z.string().nullable().optional(),
  originActionRunId: z.number().int().positive().nullable().optional(),
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

export const DiagnosticRunReportSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  identity: z.object({
    runId: z.number().int().positive(),
    hostId: z.number().int().positive(),
    hostName: z.string().nullable(),
    hostIp: z.string().nullable(),
    playbookId: z.number().int().positive(),
    playbookName: z.string(),
    status: DiagnosticRunStatusSchema,
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  }),
  traceability: z.object({
    sessionId: z.number().int().positive().nullable(),
    ticketKey: z.string().nullable(),
    actionRunId: z.number().int().positive().nullable(),
    note: z.string(),
  }),
  summary: z.object({
    status: z.string().nullable(),
    text: z.string().nullable(),
    structured: DiagnosticRunAiSummarySchema.nullable(),
  }),
  evidence: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    redacted: z.number().int().nonnegative(),
    commands: z.array(z.object({
      commandId: z.string(),
      command: z.string(),
      status: DiagnosticCommandStatusSchema,
      exitCode: z.number().int().nullable(),
      redactionApplied: z.boolean(),
      output: z.string().nullable(),
    })),
  }),
  integrity: z.object({
    algorithm: z.literal('sha256'),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  }),
})

export const DiagnosticRunComparisonChangeSchema = z.enum([
  'improved',
  'regressed',
  'unchanged',
  'added',
  'removed',
])

const DiagnosticRunComparisonSideSchema = z.object({
  runId: z.number().int().positive(),
  playbookId: z.number().int().positive(),
  playbookName: z.string(),
  status: DiagnosticRunStatusSchema,
  finishedAt: z.string().nullable(),
  riskLevel: z.enum(['low', 'medium', 'high']).nullable(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
})

export const DiagnosticRunComparisonSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  host: z.object({
    id: z.number().int().positive(),
    name: z.string().nullable(),
    ip: z.string().nullable(),
  }),
  baseline: DiagnosticRunComparisonSideSchema,
  current: DiagnosticRunComparisonSideSchema,
  verdict: z.enum(['improved', 'regressed', 'unchanged', 'mixed']),
  metrics: z.array(z.object({
    key: z.enum(['completed', 'failed', 'skipped', 'redacted', 'risk']),
    label: z.string(),
    baseline: z.string(),
    current: z.string(),
    change: z.enum(['improved', 'regressed', 'unchanged']),
  })),
  commands: z.array(z.object({
    commandId: z.string(),
    command: z.string(),
    baselineStatus: DiagnosticCommandStatusSchema.nullable(),
    currentStatus: DiagnosticCommandStatusSchema.nullable(),
    baselineExitCode: z.number().int().nullable(),
    currentExitCode: z.number().int().nullable(),
    change: DiagnosticRunComparisonChangeSchema,
  })),
  findings: z.object({
    resolved: z.array(z.string()),
    new: z.array(z.string()),
    persistent: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
})

export const DiagnosticRunHistorySchema = z.object({
  hostId: z.number().int().positive(),
  windowSize: z.number().int().positive(),
  totals: z.object({
    runs: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    commandFailures: z.number().int().nonnegative(),
    highRisk: z.number().int().nonnegative(),
  }),
  trend: z.array(z.object({
    runId: z.number().int().positive(),
    playbookId: z.number().int().positive(),
    playbookName: z.string(),
    status: DiagnosticRunStatusSchema,
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
    riskLevel: z.enum(['low', 'medium', 'high']).nullable(),
    completedCommands: z.number().int().nonnegative(),
    failedCommands: z.number().int().nonnegative(),
    skippedCommands: z.number().int().nonnegative(),
  })),
  recurringFindings: z.array(z.object({
    finding: z.string(),
    occurrences: z.number().int().positive(),
    lastSeenAt: z.string(),
    runIds: z.array(z.number().int().positive()),
  })),
  warnings: z.array(z.string()),
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
export type UpdateDiagnosticRunTraceabilityDto = z.infer<typeof UpdateDiagnosticRunTraceabilitySchema>
export type PublishDiagnosticRunReportToJiraDto = z.infer<typeof PublishDiagnosticRunReportToJiraSchema>
export type PublishDiagnosticRunReportToJiraResult = z.infer<typeof PublishDiagnosticRunReportToJiraResultSchema>
export type DiagnosticRunAiSummary = z.infer<typeof DiagnosticRunAiSummarySchema>
export type DiagnosticRunCommand = z.infer<typeof DiagnosticRunCommandSchema>
export type DiagnosticRunPublic = z.infer<typeof DiagnosticRunPublicSchema>
export type DiagnosticRunDetail = z.infer<typeof DiagnosticRunDetailSchema>
export type DiagnosticRunReport = z.infer<typeof DiagnosticRunReportSchema>
export type DiagnosticRunComparisonChange = z.infer<typeof DiagnosticRunComparisonChangeSchema>
export type DiagnosticRunComparison = z.infer<typeof DiagnosticRunComparisonSchema>
export type DiagnosticRunHistory = z.infer<typeof DiagnosticRunHistorySchema>
