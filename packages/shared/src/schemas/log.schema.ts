import { z } from 'zod'

const authEventTypes = [
  'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'LOGIN_BLOCKED',
  'MFA_VERIFIED', 'MFA_FAILED', 'SSO_LOGIN',
  'PASSWORD_RESET', 'PASSWORD_CHANGED',
] as const

const clientUxEventTypes = [
  'CLIENT_UX_SESSION_EXPIRED',
  'CLIENT_UX_SESSION_EXPIRED_TERMINAL',
  'CLIENT_UX_STALE_RELOAD_RECOVERED',
  'CLIENT_UX_STALE_RELOAD_FAILED',
] as const

const userProductivityEventTypes = [
  'USER_SNIPPET_EXECUTED',
  'USER_SCREEN_VIEWED',
] as const

export const AuthLogPublicSchema = z.object({
  id:         z.number(),
  userId:     z.number().nullable(),
  userName:   z.string().nullable(),
  userEmail:  z.string().nullable(),
  eventType:  z.enum(authEventTypes),
  ip:         z.string().nullable(),
  userAgent:  z.string().nullable(),
  success:    z.boolean(),
  timestamp:  z.coerce.date(),
})

export const AdminLogPublicSchema = z.object({
  id:         z.number(),
  adminId:    z.number(),
  adminName:  z.string(),
  action:     z.string(),
  targetType: z.string(),
  targetId:   z.number(),
  details:    z.string().nullable().optional(),
  timestamp:  z.coerce.date(),
})

export const ClientUxEventSchema = z.enum(clientUxEventTypes)

export const ClientUxEventsRequestSchema = z.object({
  events: z.array(ClientUxEventSchema).min(1).max(20),
})

export const UserProductivityEventSchema = z.enum(userProductivityEventTypes)

export const UserProductivityEventsRequestSchema = z.object({
  events: z.array(z.object({
    event: UserProductivityEventSchema,
    targetId: z.number().int().positive(),
  })).min(1).max(20),
})

export type AuthLogPublic  = z.infer<typeof AuthLogPublicSchema>
export type AdminLogPublic = z.infer<typeof AdminLogPublicSchema>
export type AuthEventType  = typeof authEventTypes[number]
export type ClientUxEvent = z.infer<typeof ClientUxEventSchema>
export type UserProductivityEvent = z.infer<typeof UserProductivityEventSchema>
