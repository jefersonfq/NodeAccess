import { z } from 'zod'
import { TagPublicSchema } from './tag.schema.js'

export const HostScopeSchema  = z.enum(['personal', 'team', 'global'])
export const AuthTypeSchema   = z.enum(['pem', 'password', 'pem_password'])
export const HostConnectionModeSchema = z.enum([
  'direct',
  'agent',
  'agent_user',
  'agent_tenant_fallback',
  'auto',
]).default('direct')

export const CreateHostSchema = z.object({
  name:           z.string().min(1).max(100),
  ip:             z.string().min(7).max(45),
  port:           z.number().int().min(1).max(65535).default(22),
  sshUser:        z.string().min(1).max(64),
  authType:       AuthTypeSchema,
  connectionMode: HostConnectionModeSchema,
  scope:          HostScopeSchema.default('personal'),
  groupId:        z.number().int().positive().optional(),
  folderId:       z.number().int().positive().optional(),
  bastionId:      z.number().int().positive().optional(),
  password:       z.string().optional(),
  pemKeyId:       z.number().int().positive().optional(),
  onePasswordRef: z.string().max(500).optional(),
  tagNames:       z.string().array().max(20).optional(),
})

export const HostPublicSchema = z.object({
  id:             z.number(),
  tenantId:       z.number(),
  name:           z.string(),
  ip:             z.string(),
  port:           z.number(),
  sshUser:        z.string(),
  authType:       AuthTypeSchema,
  connectionMode: HostConnectionModeSchema,
  scope:          HostScopeSchema,
  groupId:        z.number().nullable(),
  folderId:       z.number().nullable(),
  bastionId:      z.number().nullable(),
  effectiveBastionId:     z.number().nullable(),
  effectiveBastionName:   z.string().nullable(),
  effectiveBastionSource: z.enum(['host', 'group', 'none']),
  onePasswordRef: z.string().nullable(),
  trustedHostKeyFingerprint: z.string().nullable(),
  trustedHostKeyVerifiedAt: z.coerce.date().nullable(),
  tags:           z.array(TagPublicSchema),
  createdAt:      z.coerce.date(),
})

export const TestConnectionSchema = z.object({
  ip:        z.string().min(1),
  port:      z.number().int().min(1).max(65535),
  sshUser:   z.string().min(1),
  authType:  AuthTypeSchema,
  connectionMode: HostConnectionModeSchema.default('direct'),
  password:  z.string().optional(),
  pemKeyId:  z.number().int().positive().optional(),
  bastionId: z.number().int().positive().optional(),
  groupId:   z.number().int().positive().optional(),
})

export const TestConnectionResultSchema = z.object({
  success:   z.boolean(),
  latencyMs: z.number().nullable(),
  message:   z.string(),
})

export const TrustHostKeySchema = z.object({
  fingerprint: z.string().min(1).max(255),
})

export const HostKeyTrustEventSchema = z.object({
  action: z.enum(['HOST_KEY_TRUSTED', 'HOST_KEY_UPDATED']),
  adminName: z.string(),
  previousFingerprint: z.string().nullable(),
  nextFingerprint: z.string().nullable(),
  timestamp: z.coerce.date(),
})

export type HostScope            = z.infer<typeof HostScopeSchema>
export type AuthType             = z.infer<typeof AuthTypeSchema>
export type HostConnectionMode   = z.infer<typeof HostConnectionModeSchema>
export type CreateHostDto        = z.infer<typeof CreateHostSchema>
export type HostPublic           = z.infer<typeof HostPublicSchema>
export type TestConnectionDto    = z.infer<typeof TestConnectionSchema>
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>
export type TrustHostKeyDto      = z.infer<typeof TrustHostKeySchema>
export type HostKeyTrustEvent    = z.infer<typeof HostKeyTrustEventSchema>
