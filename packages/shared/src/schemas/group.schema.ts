import { z } from 'zod'

export const CreateGroupSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  bastionId:   z.number().int().positive().optional(),
})

export const UpdateGroupSchema = CreateGroupSchema.partial()

export const GroupPublicSchema = z.object({
  id:          z.number(),
  tenantId:    z.number(),
  name:        z.string(),
  description: z.string().nullable(),
  bastionId:   z.number().nullable(),
  createdAt:   z.coerce.date(),
})

export type CreateGroupDto = z.infer<typeof CreateGroupSchema>
export type UpdateGroupDto = z.infer<typeof UpdateGroupSchema>
export type GroupPublic    = z.infer<typeof GroupPublicSchema>