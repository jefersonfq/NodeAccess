import { z } from 'zod'
import { HostPublicSchema } from './host.schema.js'

export const HostLinkTypeSchema = z.enum(['authenticated', 'public_once'])
export const HostLinkExpiryMinutesSchema = z.number().int().min(1).max(1440)

export const CreateHostLinkSchema = z.object({
  hostId: z.number().int().positive(),
  expiresInMinutes: HostLinkExpiryMinutesSchema,
  type: HostLinkTypeSchema.optional(),
})

export const ResolvePublicHostLinkSchema = z.object({
  guestName: z.string().trim().min(2).max(80),
  pin: z.string().trim().regex(/^\d{4,10}$/).optional(),
})

export const HostLinkCreatedSchema = z.object({
  id: z.number().int().positive(),
  hostId: z.number().int().positive(),
  hostName: z.string(),
  expiresAt: z.coerce.date(),
  type: HostLinkTypeSchema,
  url: z.string().min(1),
  pin: z.string().min(4).max(10).optional(),
  pinRequired: z.boolean().optional(),
})

export const HostLinkPublicInfoSchema = z.object({
  expiresAt: z.coerce.date(),
  pinRequired: z.boolean(),
  status: z.enum(['active', 'used', 'expired', 'revoked']),
})

export const HostLinkResolvedSchema = z.object({
  host: HostPublicSchema,
  expiresAt: z.coerce.date(),
  type: HostLinkTypeSchema,
})

export const HostLinkPublicResolvedSchema = HostLinkResolvedSchema.extend({
  type: z.literal('public_once'),
  accessToken: z.string().min(1),
  guestName: z.string().min(1),
})

export type HostLinkType = z.infer<typeof HostLinkTypeSchema>
export type HostLinkExpiryMinutes = z.infer<typeof HostLinkExpiryMinutesSchema>
export type CreateHostLinkDto = z.infer<typeof CreateHostLinkSchema>
export type ResolvePublicHostLinkDto = z.infer<typeof ResolvePublicHostLinkSchema>
export type HostLinkCreated = z.infer<typeof HostLinkCreatedSchema>
export type HostLinkPublicInfo = z.infer<typeof HostLinkPublicInfoSchema>
export type HostLinkResolved = z.infer<typeof HostLinkResolvedSchema>
export type HostLinkPublicResolved = z.infer<typeof HostLinkPublicResolvedSchema>
