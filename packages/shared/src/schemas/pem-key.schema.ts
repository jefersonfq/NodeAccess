import { z } from 'zod'

export const CreatePemKeySchema = z.object({
  name:       z.string().min(1).max(100),
  key:        z.string().min(1),
  passphrase: z.string().max(1024).optional(),
})

export const UpdatePemKeyPassphraseSchema = z.object({
  passphrase: z.string().max(1024).nullable(),
})

export const PemKeyPublicSchema = z.object({
  id:          z.number(),
  name:        z.string(),
  createdById: z.number(),
  createdAt:   z.coerce.date(),
  hasPassphrase: z.boolean(),
})

export type CreatePemKeyDto = z.infer<typeof CreatePemKeySchema>
export type UpdatePemKeyPassphraseDto = z.infer<typeof UpdatePemKeyPassphraseSchema>
export type PemKeyPublic    = z.infer<typeof PemKeyPublicSchema>
