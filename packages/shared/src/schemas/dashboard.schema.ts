import { z } from 'zod'
import { AuthLogPublicSchema } from './log.schema.js'
import { TagPublicSchema }     from './tag.schema.js'

export const TagStatSchema = z.object({
  tag:       TagPublicSchema,
  hostCount: z.number(),
})

export const DashboardClientUxStatsSchema = z.object({
  sessionExpired: z.number(),
  sessionExpiredTerminal: z.number(),
  staleReloadRecovered: z.number(),
  staleReloadFailed: z.number(),
})

export const DashboardClientUxTrendSchema = z.object({
  current: DashboardClientUxStatsSchema,
  previous: DashboardClientUxStatsSchema,
})

export const DashboardHostKeyStatsSchema = z.object({
  trusted: z.number(),
  updated: z.number(),
})

export const DashboardHostKeyTrendSchema = z.object({
  current: DashboardHostKeyStatsSchema,
  previous: DashboardHostKeyStatsSchema,
})

export const DashboardTopActiveUserSchema = z.object({
  userId: z.number(),
  userName: z.string(),
  userEmail: z.string().nullable(),
  sessionCount: z.number(),
  lastAccessedAt: z.coerce.date(),
  primaryHostName: z.string().nullable(),
})

export const DashboardTopHostAccessSchema = z.object({
  hostId: z.number(),
  hostName: z.string(),
  hostIp: z.string(),
  accessCount: z.number(),
  uniqueUsers: z.number(),
})

export const DashboardTopScreenSchema = z.object({
  screenId: z.number(),
  screenLabel: z.string(),
  viewCount: z.number(),
})

export const DashboardTopResourceSchema = z.object({
  resourceType: z.string(),
  label: z.string(),
  usageCount: z.number(),
})

export const DashboardUserResourceUsageSchema = z.object({
  userId: z.number(),
  userName: z.string(),
  userEmail: z.string().nullable(),
  sessions: z.number(),
  snippets: z.number(),
  localAccess: z.number(),
  liveSessions: z.number(),
})

export const DashboardUserDrilldownHostSchema = z.object({
  hostId: z.number(),
  hostName: z.string(),
  hostIp: z.string(),
  accessCount: z.number(),
})

export const DashboardUserDrilldownAccessSchema = z.object({
  sessionId: z.number(),
  hostId: z.number(),
  hostName: z.string(),
  hostIp: z.string(),
  startedAt: z.coerce.date(),
})

export const DashboardUserDrilldownSchema = z.object({
  userId: z.number(),
  userName: z.string(),
  userEmail: z.string().nullable(),
  topHosts: z.array(DashboardUserDrilldownHostSchema),
  recentAccesses: z.array(DashboardUserDrilldownAccessSchema),
})

export const DashboardAdoptionSchema = z.object({
  topActiveUsers: z.array(DashboardTopActiveUserSchema),
  topHosts: z.array(DashboardTopHostAccessSchema),
  topScreens: z.array(DashboardTopScreenSchema),
  topResources: z.array(DashboardTopResourceSchema),
  userResourceUsage: z.array(DashboardUserResourceUsageSchema),
  userDrilldowns: z.array(DashboardUserDrilldownSchema),
})

export const DashboardStatsSchema = z.object({
  activeUsers:    z.number(),
  maxUsers:       z.number().nullable(),
  totalHosts:     z.number(),
  activeSessions: z.number(),
  sessionsToday:  z.number(),
  clientUx:       DashboardClientUxTrendSchema,
  hostKey:        DashboardHostKeyTrendSchema,
  recentAuthLogs: z.array(AuthLogPublicSchema),
  tagStats:       z.array(TagStatSchema),
  adoption:       DashboardAdoptionSchema,
})

export type TagStat       = z.infer<typeof TagStatSchema>
export type DashboardStats = z.infer<typeof DashboardStatsSchema>
export type DashboardClientUxStats = z.infer<typeof DashboardClientUxStatsSchema>
export type DashboardClientUxTrend = z.infer<typeof DashboardClientUxTrendSchema>
export type DashboardHostKeyStats = z.infer<typeof DashboardHostKeyStatsSchema>
export type DashboardHostKeyTrend = z.infer<typeof DashboardHostKeyTrendSchema>
export type DashboardAdoption = z.infer<typeof DashboardAdoptionSchema>
