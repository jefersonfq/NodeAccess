import { z } from 'zod'

export const TenantAdminBootstrapSchema = z.object({
  name:  z.string().min(2).max(120),
  email: z.string().email(),
})

export const CreateTenantSchema = z.object({
  name:   z.string().min(2).max(120),
  slug:   z.string()
    .min(2).max(63)
    .regex(/^[a-z0-9-]+$/, 'Apenas letras minúsculas, números e hífens'),
  active:     z.boolean().default(true),
  maxUsers:   z.number().int().positive().default(50),
  firstAdmin: TenantAdminBootstrapSchema.optional(),
})

export const UpdateTenantSchema = z.object({
  name:     z.string().min(2).max(120).optional(),
  active:   z.boolean().optional(),
  maxUsers: z.number().int().positive().optional(),
})

export const TenantPublicSchema = z.object({
  id:          z.number(),
  name:        z.string(),
  slug:        z.string(),
  active:      z.boolean(),
  maxUsers:    z.number().nullable(),
  activeUsers: z.number(),
  totalUsers:  z.number(),
  createdAt:   z.coerce.date(),
  updatedAt:   z.coerce.date(),
})

export const CreateTenantResultSchema = z.object({
  tenant: TenantPublicSchema,
  firstAdminTemporaryPassword: z.string().optional(),
})

export type TenantAdminBootstrapDto = z.infer<typeof TenantAdminBootstrapSchema>
export type CreateTenantDto         = z.infer<typeof CreateTenantSchema>
export type UpdateTenantDto         = z.infer<typeof UpdateTenantSchema>
export type TenantPublic            = z.infer<typeof TenantPublicSchema>
export type CreateTenantResult      = z.infer<typeof CreateTenantResultSchema>
