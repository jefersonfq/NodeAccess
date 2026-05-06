import { z } from 'zod'

export const SessionAuditPolicyModeSchema = z.enum([
  'DISABLED',
  'ALL',
  'USERS',
  'GROUPS',
  'MIXED',
])

export const SessionAuditPolicyPublicSchema = z.object({
  licensed: z.boolean(),
  enabled: z.boolean(),
  mode: SessionAuditPolicyModeSchema,
  userIds: z.array(z.number().int().positive()),
  groupIds: z.array(z.number().int().positive()),
  cache: z.object({
    enabled: z.boolean(),
    backend: z.literal('redis'),
    ttlSeconds: z.number().int().nonnegative(),
    manualClearAvailable: z.boolean(),
  }).optional(),
})

export const UpdateSessionAuditPolicySchema = z.object({
  enabled: z.boolean(),
  mode: SessionAuditPolicyModeSchema,
  userIds: z.array(z.number().int().positive()).default([]),
  groupIds: z.array(z.number().int().positive()).default([]),
})

export type SessionAuditPolicyMode = z.infer<typeof SessionAuditPolicyModeSchema>
export type SessionAuditPolicyPublic = z.infer<typeof SessionAuditPolicyPublicSchema>
export type UpdateSessionAuditPolicyDto = z.infer<typeof UpdateSessionAuditPolicySchema>
