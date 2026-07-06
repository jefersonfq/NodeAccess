import { z } from 'zod'

export const AccessMapSessionSchema = z.object({
  id: z.number().int().positive(),
  user: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    email: z.string().email(),
  }),
  startedAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  durationSeconds: z.number().int().nonnegative(),
  connectionMethod: z.string(),
  accessType: z.string(),
  clientIp: z.string().nullable(),
  agentRemoteIp: z.string().nullable(),
  agentNameSnapshot: z.string().nullable(),
})

export const AccessMapHostSchema = z.object({
  host: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    ip: z.string(),
    port: z.number().int().positive(),
    accessProtocol: z.string(),
    scope: z.string(),
    groupName: z.string().nullable(),
  }),
  activeSessions: z.number().int().nonnegative(),
  uniqueUsers: z.number().int().nonnegative(),
  oldestStartedAt: z.coerce.date(),
  lastStartedAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  sessions: z.array(AccessMapSessionSchema),
})

export const AccessMapOverviewSchema = z.object({
  generatedAt: z.coerce.date(),
  refreshAfterSeconds: z.number().int().positive(),
  totals: z.object({
    activeSessions: z.number().int().nonnegative(),
    activeHosts: z.number().int().nonnegative(),
    uniqueUsers: z.number().int().nonnegative(),
    concurrentHosts: z.number().int().nonnegative(),
  }),
  hosts: z.array(AccessMapHostSchema),
})

export type AccessMapSession = z.infer<typeof AccessMapSessionSchema>
export type AccessMapHost = z.infer<typeof AccessMapHostSchema>
export type AccessMapOverview = z.infer<typeof AccessMapOverviewSchema>
