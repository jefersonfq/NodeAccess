import { z } from 'zod'

export const FeedbackTypeSchema = z.enum(['suggestion', 'problem', 'question'])
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>

export const FeedbackStatusSchema = z.enum(['new', 'in_review', 'accepted', 'not_planned', 'completed'])
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>

export const FeedbackPublicSchema = z.object({
  id: z.number(),
  type: FeedbackTypeSchema,
  title: z.string(),
  message: z.string(),
  status: FeedbackStatusSchema,
  adminResponse: z.string().nullable(),
  contextRoute: z.string().nullable(),
  contextScreen: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  user: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
  }).optional(),
  deletedBy: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
  }).nullable().optional(),
})
export type FeedbackPublic = z.infer<typeof FeedbackPublicSchema>
