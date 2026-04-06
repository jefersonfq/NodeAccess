import { z } from 'zod'

export const UserDashboardTopHostSchema = z.object({
  hostId: z.number(),
  hostName: z.string(),
  hostIp: z.string(),
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
