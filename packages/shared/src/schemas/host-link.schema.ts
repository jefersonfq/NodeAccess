import { z } from 'zod'
import { HostPublicSchema } from './host.schema.js'

export const HostLinkTypeSchema = z.enum(['authenticated', 'public_once'])
export const HostLinkExpiryMinutesSchema = z.union([z.literal(5), z.literal(10), z.literal(30)])

export const CreateHostLinkSchema = z.object({
  hostId: z.number().int().positive(),
  expiresInMinutes: HostLinkExpiryMinutesSchema,
})

export const HostLinkCreatedSchema = z.object({
  id: z.number().int().positive(),
  hostId: z.number().int().positive(),
  hostName: z.string(),
  expiresAt: z.coerce.date(),
  type: HostLinkTypeSchema,
  url: z.string().min(1),
})

export const HostLinkResolvedSchema = z.object({
  host: HostPublicSchema,
  expiresAt: z.coerce.date(),
  type: HostLinkTypeSchema,
})

export type HostLinkType = z.infer<typeof HostLinkTypeSchema>
export type HostLinkExpiryMinutes = z.infer<typeof HostLinkExpiryMinutesSchema>
export type CreateHostLinkDto = z.infer<typeof CreateHostLinkSchema>
export type HostLinkCreated = z.infer<typeof HostLinkCreatedSchema>
export type HostLinkResolved = z.infer<typeof HostLinkResolvedSchema>
