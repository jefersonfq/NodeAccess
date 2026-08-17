import { z } from 'zod'
import { AiSshActionRunPublicSchema } from './ai-ssh-action.schema.js'

export const AiInvestigationStatusSchema = z.enum(['OPEN', 'WAITING_USER', 'COMPLETED', 'ABANDONED'])
export const AiInvestigationReportSchema = z.object({
  id: z.number().int().positive(), investigationId: z.number().int().positive(), createdById: z.number().int().positive(),
  provider: z.string().nullable(), model: z.string().nullable(), summary: z.string(), facts: z.array(z.string()),
  hypotheses: z.array(z.string()), risks: z.array(z.string()), recommendations: z.array(z.string()), actions: z.array(z.string()),
  evidence: z.array(z.object({ actionRunId: z.number().int().positive(), stepIds: z.array(z.string()).default([]) })),
  redactionApplied: z.boolean(), checksum: z.string(), createdAt: z.coerce.date(),
})
export const AiInvestigationSchema = z.object({
  id: z.number().int().positive(), tenantId: z.number().int().positive(), hostId: z.number().int().positive(),
  hostName: z.string(), hostIp: z.string(), requestedById: z.number().int().positive(), requestedByName: z.string(),
  mcpTokenId: z.number().int().positive().nullable(), mcpTokenName: z.string().nullable(), objective: z.string(),
  status: AiInvestigationStatusSchema, expiresAt: z.coerce.date(), lastActivityAt: z.coerce.date(),
  closedAt: z.coerce.date().nullable(), closeReason: z.string().nullable(), createdAt: z.coerce.date(),
  actionRuns: z.array(AiSshActionRunPublicSchema).default([]), reports: z.array(AiInvestigationReportSchema).default([]),
})
export const StartAiInvestigationSchema = z.object({ target: z.union([z.string(), z.number().int().positive()]), objective: z.string().trim().min(1).max(500), ttlMinutes: z.number().int().min(5).max(1440).default(60) })
export const CompleteAiInvestigationSchema = z.object({
  summary: z.string().trim().min(1).max(10000), facts: z.array(z.string().max(1000)).max(50).default([]), hypotheses: z.array(z.string().max(1000)).max(50).default([]),
  risks: z.array(z.string().max(1000)).max(50).default([]), recommendations: z.array(z.string().max(1000)).max(50).default([]), actions: z.array(z.string().max(1000)).max(100).default([]),
  evidence: z.array(z.object({ actionRunId: z.number().int().positive(), stepIds: z.array(z.string().max(80)).max(50).default([]) })).max(100).default([]),
  provider: z.string().max(80).nullable().optional(), model: z.string().max(160).nullable().optional(), confirmedByUser: z.literal(true),
})
export type AiInvestigation = z.infer<typeof AiInvestigationSchema>
export type CompleteAiInvestigationDto = z.infer<typeof CompleteAiInvestigationSchema>
