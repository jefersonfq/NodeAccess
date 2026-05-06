import { z } from 'zod'
import { HostConnectionModeSchema, HostScopeSchema } from './host.schema.js'
import { TagPublicSchema } from './tag.schema.js'

export const HostDashboardPeriodDaysSchema = z.union([
  z.literal(7),
  z.literal(15),
  z.literal(30),
  z.literal(60),
])

export const HostDashboardHostSchema = z.object({
  id: z.number(),
  name: z.string(),
  ip: z.string(),
  port: z.number(),
  sshUser: z.string(),
  deleted: z.boolean().default(false),
  deletedAt: z.coerce.date().nullable().optional(),
  scope: HostScopeSchema,
  connectionMode: HostConnectionModeSchema,
  effectiveBastionName: z.string().nullable(),
  effectiveBastionSource: z.enum(['host', 'group', 'none']),
  trustedHostKeyVerifiedAt: z.coerce.date().nullable(),
  tags: z.array(TagPublicSchema),
  associatedLinksCount: z.number(),
})

export const HostDashboardSummarySchema = z.object({
  sessions: z.number(),
  activeSessions: z.number(),
  failedSessions: z.number(),
  uniqueUsers: z.number().nullable(),
  audits: z.number(),
  auditEvents: z.number(),
  bytesIn: z.number(),
  bytesOut: z.number(),
  sharedSessions: z.number(),
  activeSharedSessions: z.number(),
  forwardings: z.number(),
  webForwardings: z.number(),
})

export const HostDashboardDailyPointSchema = z.object({
  date: z.string(),
  sessions: z.number(),
  failedSessions: z.number(),
})

export const HostDashboardRoutePointSchema = z.object({
  route: z.string(),
  count: z.number(),
})

export const HostDashboardOriginPointSchema = z.object({
  ip: z.string(),
  count: z.number(),
  lastSeenAt: z.coerce.date(),
})

export const HostDashboardAuditPostureSchema = z.object({
  running: z.number(),
  completed: z.number(),
  failed: z.number(),
  purged: z.number(),
  riskHigh: z.number(),
  riskMedium: z.number(),
  riskLow: z.number(),
})

export const HostDashboardHealthSchema = z.object({
  status: z.enum(['healthy', 'attention', 'critical']),
  score: z.number().int().min(0).max(100),
  title: z.string(),
  reasons: z.array(z.string()),
})

export const HostDashboardRecentSessionSchema = z.object({
  id: z.number(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  active: z.boolean(),
  connectionMethod: z.string(),
  clientIp: z.string().nullable(),
  agentRemoteIp: z.string().nullable(),
  errorCode: z.string().nullable(),
})

export const HostDashboardTimelineItemSchema = z.object({
  id: z.string(),
  type: z.enum(['session', 'audit', 'sharing']),
  title: z.string(),
  description: z.string(),
  occurredAt: z.coerce.date(),
  severity: z.enum(['info', 'success', 'warning', 'error']),
  sessionId: z.number().nullable(),
})

export const HostDashboardCacheInfoSchema = z.object({
  enabled: z.boolean(),
  hit: z.boolean(),
  ttlSeconds: z.number(),
  generatedAt: z.coerce.date(),
})

export const HostDashboardSchema = z.object({
  host: HostDashboardHostSchema,
  periodDays: HostDashboardPeriodDaysSchema,
  viewer: z.object({
    role: z.enum(['admin', 'user']),
    restrictedToOwnActivity: z.boolean(),
  }),
  summary: HostDashboardSummarySchema,
  daily: z.array(HostDashboardDailyPointSchema),
  routes: z.array(HostDashboardRoutePointSchema),
  origins: z.array(HostDashboardOriginPointSchema),
  auditPosture: HostDashboardAuditPostureSchema,
  health: HostDashboardHealthSchema,
  recentSessions: z.array(HostDashboardRecentSessionSchema),
  timeline: z.array(HostDashboardTimelineItemSchema),
  cache: HostDashboardCacheInfoSchema,
})

export type HostDashboardPeriodDays = z.infer<typeof HostDashboardPeriodDaysSchema>
export type HostDashboard = z.infer<typeof HostDashboardSchema>
