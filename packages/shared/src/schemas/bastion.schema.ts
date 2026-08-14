import { z } from 'zod'

const BastionInputSchema = z.object({
  sourceHostId: z.number().int().positive().optional(),
  name:       z.string().min(1).max(100).optional(),
  ip:         z.string().min(1).optional(),
  port:       z.number().int().min(1).max(65535).default(22).optional(),
  sshUser:    z.string().min(1).optional(),
  authType:   z.enum(['pem', 'password', 'pem_password']).optional(),
  systemPemKeyId: z.number().int().positive().optional(),
  pemKeyName: z.string().min(1).optional(),
  pemKey:     z.string().min(1).optional(),
  password:   z.string().min(1).optional(),
})

export const CreateBastionSchema = BastionInputSchema.superRefine((value, context) => {
  if (value.sourceHostId !== undefined) return
  for (const field of ['name', 'ip', 'sshUser', 'authType'] as const) {
    if (value[field] === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Obrigatório para bastion legado' })
  }
})

export const UpdateBastionSchema = BastionInputSchema.partial()

export const BastionPublicSchema = z.object({
  id:        z.number(),
  sourceHostId: z.number().nullable(),
  sourceType: z.enum(['host', 'legacy']),
  sourceHost: z.object({
    id: z.number(),
    name: z.string(),
    ip: z.string(),
    port: z.number(),
    connectionMode: z.string(),
  }).nullable(),
  name:      z.string(),
  ip:        z.string(),
  port:      z.number(),
  sshUser:   z.string(),
  authType:  z.enum(['pem', 'password', 'pem_password']),
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
