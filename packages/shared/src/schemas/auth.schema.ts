import { z } from 'zod'

export const LoginSchema = z.object({
  email:    z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

export const VerifyTotpSchema = z.object({
  token:     z.string().length(6, 'Código deve ter 6 dígitos').regex(/^\d+$/),
  setupToken: z.string().optional(),
})

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
})

export const AuthResponseSchema = z.object({
  accessToken:      z.string(),
  refreshToken:     z.string(),
  requiresMfaSetup: z.boolean().optional(),
  setupToken:       z.string().optional(),
})

/** Resposta intermediária: senha OK, aguardando TOTP */
export const LoginPendingSchema = z.object({
  tempToken:        z.string(),
  requiresMfaSetup: z.boolean().optional(),
})

export const GoogleLoginSchema = z.object({
  credential: z.string().min(1, 'Credencial Google obrigatória'),
})

export type LoginDto        = z.infer<typeof LoginSchema>
export type VerifyTotpDto   = z.infer<typeof VerifyTotpSchema>
export type AuthResponse    = z.infer<typeof AuthResponseSchema>
export type LoginPending    = z.infer<typeof LoginPendingSchema>
export type GoogleLoginDto  = z.infer<typeof GoogleLoginSchema>