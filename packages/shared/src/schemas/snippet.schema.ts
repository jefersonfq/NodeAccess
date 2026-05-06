import { z } from 'zod'

// ── Scope ─────────────────────────────────────────────────────────────────────

export const SnippetScopeSchema = z.enum(['PERSONAL', 'TEAM'])
export type SnippetScope = z.infer<typeof SnippetScopeSchema>

// ── SnippetGroup ──────────────────────────────────────────────────────────────

export const CreateSnippetGroupSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).nullish(),
  scope:       SnippetScopeSchema.default('PERSONAL'),
})

export const UpdateSnippetGroupSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  scope:       SnippetScopeSchema.optional(),
})

export const SnippetGroupSchema = z.object({
  id:          z.number(),
  tenantId:    z.number(),
  name:        z.string(),
  description: z.string().nullable(),
  scope:       SnippetScopeSchema,
  createdById: z.number(),
  createdAt:   z.coerce.date(),
  updatedAt:   z.coerce.date(),
})

export type CreateSnippetGroupDto = z.infer<typeof CreateSnippetGroupSchema>
export type UpdateSnippetGroupDto = z.infer<typeof UpdateSnippetGroupSchema>
export type SnippetGroupDto       = z.infer<typeof SnippetGroupSchema>

// ── Snippet (com grupo opcional) ──────────────────────────────────────────────

export const SnippetSchema = z.object({
  id:          z.number(),
  name:        z.string(),
  command:     z.string(),
  description: z.string().nullable(),
  scope:       SnippetScopeSchema,
  groupId:     z.number().nullable(),
  group:       SnippetGroupSchema.pick({ id: true, name: true, scope: true }).nullable(),
  createdAt:   z.coerce.date(),
  updatedAt:   z.coerce.date(),
  createdBy:   z.object({ id: z.number(), name: z.string() }),
})

export const CreateSnippetSchema = z.object({
  name:        z.string().min(1),
  command:     z.string().min(1),
  description: z.string().nullish(),
  scope:       SnippetScopeSchema,
  groupId:     z.number().int().positive().nullable().optional(),
})

export const UpdateSnippetSchema = z.object({
  name:        z.string().min(1).optional(),
  command:     z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  scope:       SnippetScopeSchema.optional(),
  groupId:     z.number().int().positive().nullable().optional(),
})

export type SnippetDto        = z.infer<typeof SnippetSchema>
export type CreateSnippetDto  = z.infer<typeof CreateSnippetSchema>
export type UpdateSnippetDto  = z.infer<typeof UpdateSnippetSchema>
