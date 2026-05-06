import { z } from 'zod'

export const SecretScopeSchema = z.enum(['PERSONAL', 'GROUP', 'TENANT'])
export type SecretScope = z.infer<typeof SecretScopeSchema>

export const SecretSourceSchema = z.enum(['MANUAL', 'HOST_CONNECTION'])
export type SecretSource = z.infer<typeof SecretSourceSchema>

export const SecretPublicSchema = z.object({
  id:                z.number(),
  tenantId:          z.number(),
  alias:             z.string(),
  description:       z.string().nullable(),
  scope:             SecretScopeSchema,
  ownerUserId:       z.number().nullable(),
  groupId:           z.number().nullable(),
  createdByUserId:   z.number().nullable(),
  createdByUsername: z.string().nullable(),
  source:            SecretSourceSchema,
  createdAt:         z.coerce.date(),
  updatedAt:         z.coerce.date(),
  rotatedAt:         z.coerce.date().nullable(),
  revokedAt:         z.coerce.date().nullable(),
})

export const CreateSecretSchema = z.object({
  alias:       z.string().min(2).max(120).regex(/^[a-zA-Z0-9_.:-]+$/, 'Alias deve usar letras, números, ., _, : ou -'),
  value:       z.string().min(1),
  description: z.string().max(500).optional(),
  scope:       SecretScopeSchema.default('PERSONAL'),
  groupId:     z.number().int().positive().optional(),
  source:      SecretSourceSchema.default('MANUAL'),
})

export const UpdateSecretSchema = z.object({
  alias:       z.string().min(2).max(120).regex(/^[a-zA-Z0-9_.:-]+$/, 'Alias deve usar letras, números, ., _, : ou -').optional(),
  description: z.string().max(500).nullable().optional(),
  scope:       SecretScopeSchema.optional(),
  groupId:     z.number().int().positive().nullable().optional(),
})

export const RotateSecretSchema = z.object({
  value: z.string().min(1),
})

export type SecretPublic    = z.infer<typeof SecretPublicSchema>
export type CreateSecretDto = z.infer<typeof CreateSecretSchema>
export type UpdateSecretDto = z.infer<typeof UpdateSecretSchema>
export type RotateSecretDto = z.infer<typeof RotateSecretSchema>

