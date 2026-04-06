import { z } from 'zod'

export const PasswordPolicySchema = z.object({
  minLength:   z.number().int().min(1),
  regex:       z.string(),
  description: z.string(),
})

export type PasswordPolicy = z.infer<typeof PasswordPolicySchema>