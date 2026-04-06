import { z } from 'zod'

export const RoleSchema = z.enum(['admin', 'user'])
export type Role = z.infer<typeof RoleSchema>

export function buildPasswordSchema(regex: string, description: string): z.ZodString {
  return z.string().min(1, 'Senha obrigatória').regex(new RegExp(regex), description)
}

export const CreateUserSchema = z.object({
  name:           z.string().min(2).max(120),
  email:          z.string().email(),
  role:           RoleSchema.default('user'),
  canManageHosts: z.boolean().default(false),
  groupIds:       z.array(z.number().int().positive()).default([]),
})

export const UpdateUserSchema = CreateUserSchema.partial().omit({ email: true })

export const UserPublicSchema = z.object({
  id:             z.number(),
  tenantId:       z.number(),
  name:           z.string(),
  email:          z.string(),
  role:           RoleSchema,
  canManageHosts: z.boolean(),
  mfaEnabled:     z.boolean(),
  active:         z.boolean(),
  groupIds:       z.array(z.number()).default([]),
  createdAt:      z.coerce.date(),
  updatedAt:      z.coerce.date(),
})

export type CreateUserDto = z.infer<typeof CreateUserSchema>
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>
export type UserPublic    = z.infer<typeof UserPublicSchema>