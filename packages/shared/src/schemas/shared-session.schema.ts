import { z } from 'zod'
import { HostPublicSchema } from './host.schema.js'

export const SharedSessionStatusSchema = z.enum(['active', 'ended', 'revoked'])
export const SharedSessionParticipantRoleSchema = z.enum(['owner', 'viewer'])
export const SharedSessionExpiryMinutesSchema = z.number().int().min(1).max(1440)
export const SharedSessionControlLeaseMinutesSchema = z.union([z.literal(2), z.literal(5), z.literal(10), z.literal(30)])
export const SharedSessionControlEndReasonSchema = z.enum([
  'revoked',
  'expired',
  'session_ended',
  'owner_disconnected',
  'relinquished',
])

export const SharedSessionOwnerSchema = z.object({
  userId: z.number().int().positive(),
  name: z.string(),
  email: z.string().email().nullable(),
})

export const SharedSessionParticipantSchema = z.object({
  userId: z.number().int().positive(),
  name: z.string(),
  email: z.string().email().nullable(),
  role: SharedSessionParticipantRoleSchema,
  joinedAt: z.coerce.date(),
  leftAt: z.coerce.date().nullable(),
  lastSeenAt: z.coerce.date().nullable(),
})

export const SharedSessionControlLeaseSchema = z.object({
  id: z.number().int().positive(),
  sharedSessionId: z.number().int().positive(),
  controllerUserId: z.number().int().positive(),
  grantedByUserId: z.number().int().positive(),
  startedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  endReason: SharedSessionControlEndReasonSchema.nullable(),
  revokeReason: z.string().nullable(),
})

export const CreateSharedSessionSchema = z.object({
  sessionId: z.number().int().positive(),
  expiresInMinutes: SharedSessionExpiryMinutesSchema,
  initialOutputSnapshot: z.string().max(120000).optional(),
})

export const SharedSessionPublicSchema = z.object({
  id: z.number().int().positive(),
  tenantId: z.number().int().positive(),
  hostId: z.number().int().positive(),
  hostName: z.string(),
  hostDeleted: z.boolean().default(false),
  sessionId: z.number().int().positive(),
  status: SharedSessionStatusSchema,
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  owner: SharedSessionOwnerSchema,
  participants: z.array(SharedSessionParticipantSchema),
  activeControlLease: SharedSessionControlLeaseSchema.nullable().optional(),
  pendingControlRequestUserIds: z.array(z.number().int().positive()).optional(),
})

export const SharedSessionCreatedSchema = SharedSessionPublicSchema.extend({
  joinUrl: z.string().min(1),
})

export const SharedSessionResolvedSchema = z.object({
  sharedSessionId: z.number().int().positive(),
  role: SharedSessionParticipantRoleSchema,
  host: HostPublicSchema,
  hostDeleted: z.boolean().default(false),
  owner: SharedSessionOwnerSchema,
  expiresAt: z.coerce.date(),
  wsChannel: z.string().min(1),
  activeControlLease: SharedSessionControlLeaseSchema.nullable().optional(),
  pendingControlRequestUserIds: z.array(z.number().int().positive()).optional(),
})

export const RequestSharedSessionControlSchema = z.object({})

export const GrantSharedSessionControlSchema = z.object({
  leaseMinutes: SharedSessionControlLeaseMinutesSchema,
})

export const SharedSessionControlActionResultSchema = z.object({
  sharedSessionId: z.number().int().positive(),
  status: z.enum(['requested', 'granted', 'denied', 'revoked']),
  activeControlLease: SharedSessionControlLeaseSchema.nullable().optional(),
})

export const DenySharedSessionControlSchema = z.object({
  reason: z.string().trim().min(1).max(255).optional(),
})

export const RevokeSharedSessionControlSchema = z.object({
  reason: z.string().trim().min(1).max(255).optional(),
})

export type SharedSessionStatus = z.infer<typeof SharedSessionStatusSchema>
export type SharedSessionParticipantRole = z.infer<typeof SharedSessionParticipantRoleSchema>
export type SharedSessionExpiryMinutes = z.infer<typeof SharedSessionExpiryMinutesSchema>
export type SharedSessionControlLeaseMinutes = z.infer<typeof SharedSessionControlLeaseMinutesSchema>
export type SharedSessionControlEndReason = z.infer<typeof SharedSessionControlEndReasonSchema>
export type SharedSessionOwner = z.infer<typeof SharedSessionOwnerSchema>
export type SharedSessionParticipant = z.infer<typeof SharedSessionParticipantSchema>
export type SharedSessionControlLease = z.infer<typeof SharedSessionControlLeaseSchema>
export type CreateSharedSessionDto = z.infer<typeof CreateSharedSessionSchema>
export type SharedSessionPublic = z.infer<typeof SharedSessionPublicSchema>
export type SharedSessionCreated = z.infer<typeof SharedSessionCreatedSchema>
export type SharedSessionResolved = z.infer<typeof SharedSessionResolvedSchema>
export type RequestSharedSessionControlDto = z.infer<typeof RequestSharedSessionControlSchema>
export type GrantSharedSessionControlDto = z.infer<typeof GrantSharedSessionControlSchema>
export type DenySharedSessionControlDto = z.infer<typeof DenySharedSessionControlSchema>
export type RevokeSharedSessionControlDto = z.infer<typeof RevokeSharedSessionControlSchema>
export type SharedSessionControlActionResult = z.infer<typeof SharedSessionControlActionResultSchema>
