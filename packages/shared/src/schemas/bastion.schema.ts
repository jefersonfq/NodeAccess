import { z } from 'zod'

export const CreateBastionSchema = z.object({
  name:       z.string().min(1).max(100),
  ip:         z.string().min(1),
  port:       z.number().int().min(1).max(65535).default(22),
  sshUser:    z.string().min(1),
  authType:   z.enum(['pem', 'password']),
  systemPemKeyId: z.number().int().positive().optional(),
  pemKeyName: z.string().min(1).optional(),
  pemKey:     z.string().min(1).optional(),
  password:   z.string().min(1).optional(),
})

export const UpdateBastionSchema = CreateBastionSchema.partial()

export const BastionPublicSchema = z.object({
  id:        z.number(),
  name:      z.string(),
  ip:        z.string(),
  port:      z.number(),
  sshUser:   z.string(),
  authType:  z.enum(['pem', 'password']),
  pemKeyId:  z.number().nullable(),
  systemPemKeyId: z.number().nullable(),
  pemKeySource: z.enum(['registered', 'legacy', 'none']),
  usage:     z.object({
    directHostCount:    z.number().int().nonnegative(),
    inheritedHostCount: z.number().int().nonnegative(),
    groupCount:         z.number().int().nonnegative(),
    directHostNames:    z.array(z.string()),
    inheritedHostNames: z.array(z.string()),
    groupNames:         z.array(z.string()),
  }).optional(),
  createdAt: z.coerce.date(),
})

export type CreateBastionDto = z.infer<typeof CreateBastionSchema>
export type UpdateBastionDto = z.infer<typeof UpdateBastionSchema>
export type BastionPublic    = z.infer<typeof BastionPublicSchema>
