import { z } from 'zod'

export const CreateTenantSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string()
    .min(2).max(63)
    .regex(/^[a-z0-9-]+$/, 'Apenas letras minúsculas, números e hífens'),
})

export const TenantPublicSchema = z.object({
  id:        z.number(),
  name:      z.string(),
  slug:      z.string(),
  active:    z.boolean(),
  createdAt: z.coerce.date(),
})

export type CreateTenantDto = z.infer<typeof CreateTenantSchema>
export type TenantPublic    = z.infer<typeof TenantPublicSchema>