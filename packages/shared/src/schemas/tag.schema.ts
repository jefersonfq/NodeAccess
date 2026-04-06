import { z } from 'zod'

export const TagPublicSchema = z.object({
  id:    z.number(),
  name:  z.string(),
  color: z.string(),
})

export type TagPublic = z.infer<typeof TagPublicSchema>
