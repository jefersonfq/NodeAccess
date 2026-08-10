import { z } from 'zod'

export const TenantAuthPolicySchema = z.object({
  localLoginEnabled: z.boolean(),
  ssoRequired: z.boolean(),
  mfaRequired: z.boolean(),
  jitProvisioningEnabled: z.boolean(),
  automaticAccountLinkingEnabled: z.boolean(),
  emailTenantDiscoveryEnabled: z.boolean(),
  lockoutMaxAttempts: z.number().int().min(1).max(100).optional(),
  lockoutDurationMinutes: z.number().int().min(1).max(10_080).optional(),
  accessTokenMinutes: z.number().int().min(1).max(1_440).optional(),
  refreshTokenDays: z.number().int().min(1).max(365).optional(),
})

export const EffectiveTenantAuthPolicySchema = TenantAuthPolicySchema.extend({
  lockoutMaxAttempts: z.number().int(),
  lockoutDurationMinutes: z.number().int(),
  accessTokenMinutes: z.number().int(),
  refreshTokenDays: z.number().int(),
})

export const TenantAuthPolicyPublicSchema = z.object({
  requested: TenantAuthPolicySchema,
  effective: EffectiveTenantAuthPolicySchema,
  enforcementEnabled: z.boolean(),
  ssoRequiredEnforced: z.boolean(),
  localLoginEnforced: z.boolean(),
  emailTenantDiscoveryEnforced: z.boolean(),
  lockoutPolicyEnforced: z.boolean(),
  tokenLifetimeEnforced: z.boolean(),
})

export const ValidateBreakGlassSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1024),
})

export const BreakGlassStatusSchema = z.object({
  configured: z.boolean(),
  userId: z.number().int().nullable(),
  email: z.string().email().nullable(),
  validatedAt: z.coerce.date().nullable(),
})

export type TenantAuthPolicyDto = z.infer<typeof TenantAuthPolicySchema>
export type TenantAuthPolicyPublic = z.infer<typeof TenantAuthPolicyPublicSchema>
export type ValidateBreakGlassDto = z.infer<typeof ValidateBreakGlassSchema>
export type BreakGlassStatus = z.infer<typeof BreakGlassStatusSchema>
