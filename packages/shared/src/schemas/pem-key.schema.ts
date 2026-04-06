import { z } from 'zod'

export const CreatePemKeySchema = z.object({
  name: z.string().min(1).max(100),
  key:  z.string().min(1),
})

export const PemKeyPublicSchema = z.object({
  id:          z.number(),
  name:        z.string(),
  createdById: z.number(),
  createdAt:   z.coerce.date(),
})

export type CreatePemKeyDto = z.infer<typeof CreatePemKeySchema>
export type PemKeyPublic    = z.infer<typeof PemKeyPublicSchema>
