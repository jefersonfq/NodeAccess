import { z } from 'zod'

export const UserDashboardTopHostSchema = z.object({
  hostId: z.number(),
  hostName: z.string(),
  hostIp: z.string(),
  hostDeleted: z.boolean().default(false),
  accessCount: z.number(),
  lastAccessedAt: z.coerce.date(),
})

export const UserDashboardTopSnippetSchema = z.object({
  snippetId: z.number(),
  snippetName: z.string(),
  usageCount: z.number(),
})

export const UserDashboardTopLocalAccessSchema = z.object({
  forwardingId: z.number(),
  label: z.string(),
  hostName: z.string(),
  usageCount: z.number(),
})

export const UserDashboardWeeklyActivitySchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  sessions: z.number(),
  sharedSessions: z.number(),
})

export const UserDashboardSummarySchema = z.object({
  activeSessions: z.number(),
  totalSessionsLast30Days: z.number(),
  uniqueHostsLast30Days: z.number(),
  totalSnippetExecutionsLast30Days: z.number(),
  totalLocalAccessLast30Days: z.number(),
  sharedSessionsOwnedLast30Days: z.number(),
  sharedSessionsParticipatedLast30Days: z.number(),
  topHostsLast30Days: z.array(UserDashboardTopHostSchema),
  topSnippetsLast30Days: z.array(UserDashboardTopSnippetSchema),
  topLocalAccessLast30Days: z.array(UserDashboardTopLocalAccessSchema),
  weeklyActivityLast4Weeks: z.array(UserDashboardWeeklyActivitySchema),
})

export type UserDashboardTopHost = z.infer<typeof UserDashboardTopHostSchema>
export type UserDashboardTopSnippet = z.infer<typeof UserDashboardTopSnippetSchema>
export type UserDashboardTopLocalAccess = z.infer<typeof UserDashboardTopLocalAccessSchema>
export type UserDashboardWeeklyActivity = z.infer<typeof UserDashboardWeeklyActivitySchema>
export type UserDashboardSummary = z.infer<typeof UserDashboardSummarySchema>

// ─── UserDashboard v2 (dashboard completo) ───────────────────────────────────

export const UserDashboardPeriodDaysSchema = z.union([z.literal(7), z.literal(15), z.literal(30), z.literal(60)])
export type UserDashboardPeriodDays = z.infer<typeof UserDashboardPeriodDaysSchema>

export const UserDashboardUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['admin', 'user']),
})

export const UserDashboardSummaryV2Schema = z.object({
  sessions: z.number(),
  activeSessions: z.number(),
  failedSessions: z.number(),
  hostsAccessed: z.number(),
  audits: z.number(),
  auditEvents: z.number(),
  bytesIn: z.number(),
  bytesOut: z.number(),
  sharedSessionsOwned: z.number(),
  sharedSessionsParticipated: z.number(),
})

export const UserDashboardDailyPointSchema = z.object({
  date: z.string(),
  sessions: z.number(),
  failedSessions: z.number(),
})

export const UserDashboardTopHostV2Schema = z.object({
  hostId: z.number(),
  hostName: z.string(),
  hostIp: z.string(),
  hostDeleted: z.boolean().default(false),
  count: z.number(),
  lastSeenAt: z.coerce.date(),
})

export const UserDashboardAuditPostureSchema = z.object({
  running: z.number(),
  completed: z.number(),
  failed: z.number(),
  purged: z.number(),
  riskHigh: z.number(),
  riskMedium: z.number(),
  riskLow: z.number(),
})

export const UserDashboardRecentSessionSchema = z.object({
  id: z.number(),
  hostName: z.string(),
  hostIp: z.string(),
  hostDeleted: z.boolean().default(false),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable(),
  active: z.boolean(),
  connectionMethod: z.string(),
  errorCode: z.string().nullable(),
})

export const UserDashboardTimelineItemSchema = z.object({
  id: z.string(),
  type: z.enum(['session', 'audit', 'sharing']),
  title: z.string(),
  description: z.string(),
  hostDeleted: z.boolean().default(false),
  occurredAt: z.coerce.date(),
  severity: z.enum(['info', 'success', 'warning', 'error']),
  sessionId: z.number().nullable(),
})

export const UserDashboardCacheInfoSchema = z.object({
  enabled: z.boolean(),
  hit: z.boolean(),
  ttlSeconds: z.number(),
  generatedAt: z.coerce.date(),
})

export const UserDashboardSchema = z.object({
  user: UserDashboardUserSchema,
  periodDays: UserDashboardPeriodDaysSchema,
  summary: UserDashboardSummaryV2Schema,
  daily: z.array(UserDashboardDailyPointSchema),
  topHosts: z.array(UserDashboardTopHostV2Schema),
  auditPosture: UserDashboardAuditPostureSchema,
  recentSessions: z.array(UserDashboardRecentSessionSchema),
  timeline: z.array(UserDashboardTimelineItemSchema),
  cache: UserDashboardCacheInfoSchema,
})

export type UserDashboard = z.infer<typeof UserDashboardSchema>
export type UserDashboardSummaryV2 = z.infer<typeof UserDashboardSummaryV2Schema>
export type UserDashboardDailyPoint = z.infer<typeof UserDashboardDailyPointSchema>
export type UserDashboardTopHostV2 = z.infer<typeof UserDashboardTopHostV2Schema>
export type UserDashboardAuditPosture = z.infer<typeof UserDashboardAuditPostureSchema>
export type UserDashboardRecentSession = z.infer<typeof UserDashboardRecentSessionSchema>
export type UserDashboardTimelineItem = z.infer<typeof UserDashboardTimelineItemSchema>
