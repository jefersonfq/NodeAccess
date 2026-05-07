import { z } from 'zod'

export const LocalAiProposedActionTypeSchema = z.enum([
  'test_host_connection',
])

export const LocalAiProposedActionStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
])

export const LocalAiProposedActionTargetTypeSchema = z.enum([
  'host',
])

export const LocalAiProposedActionSchema = z.object({
  id: z.number().int().positive(),
  actionType: LocalAiProposedActionTypeSchema,
  status: LocalAiProposedActionStatusSchema,
  targetType: LocalAiProposedActionTargetTypeSchema,
  targetId: z.number().int().positive(),
  title: z.string(),
  reason: z.string(),
  riskLevel: z.string(),
  requiresApproval: z.boolean(),
  executionEnabled: z.boolean(),
  reviewNote: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  requester: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    email: z.string(),
  }),
  reviewedBy: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    email: z.string(),
  }).nullable(),
})

export const CreateLocalAiProposedActionSchema = z.object({
  actionType: LocalAiProposedActionTypeSchema,
  targetType: LocalAiProposedActionTargetTypeSchema,
  targetId: z.number().int().positive(),
  title: z.string().min(4).max(160),
  reason: z.string().min(10).max(5000),
})

export const ReviewLocalAiProposedActionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reviewNote: z.string().max(5000).nullable().optional(),
})

export type LocalAiProposedActionType = z.infer<typeof LocalAiProposedActionTypeSchema>
export type LocalAiProposedActionStatus = z.infer<typeof LocalAiProposedActionStatusSchema>
export type LocalAiProposedAction = z.infer<typeof LocalAiProposedActionSchema>
export type CreateLocalAiProposedActionDto = z.infer<typeof CreateLocalAiProposedActionSchema>
export type ReviewLocalAiProposedActionDto = z.infer<typeof ReviewLocalAiProposedActionSchema>
