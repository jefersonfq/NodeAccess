import api from './api'
import type { Paginated } from '@nodeaccess/shared'

export interface SnippetUsageReportSummary {
  totalExecutions: number
  uniqueUsers: number
  uniqueSnippets: number
  failedExecutions: number
}

export interface SnippetUsageTopSnippet {
  snippetId: number | null
  snippetName: string | null
  count: number
  failedCount: number
}

export interface SnippetUsageTopUser {
  userId: number
  userName: string
  userEmail: string
  count: number
}

export interface SnippetUsageExecution {
  id: number
  userId: number
  userName: string
  userEmail: string
  snippetId: number | null
  snippetName: string | null
  snippetScope: string | null
  hostId: number | null
  hostName: string | null
  sessionId: number | null
  source: string
  status: string
  executedAt: string
}

export interface SnippetUsageReport {
  summary: SnippetUsageReportSummary
  topSnippets: SnippetUsageTopSnippet[]
  topUsers: SnippetUsageTopUser[]
  executions: Paginated<SnippetUsageExecution>
}

export interface SessionUsageReportSummary {
  totalSessions: number
  activeSessions: number
  failedSessions: number
  uniqueUsers: number
  uniqueHosts: number
}

export interface SessionUsageTopHost {
  hostId: number
  hostName: string
  hostIp: string
  count: number
  failedCount: number
}

export interface SessionUsageTopUser {
  userId: number
  userName: string
  userEmail: string
  count: number
  failedCount: number
}

export interface SessionUsageSession {
  id: number
  userId: number
  userName: string
  userEmail: string
  hostId: number
  hostName: string
  hostIp: string
  startedAt: string
  endedAt: string | null
  active: boolean
  connectionMethod: string
  accessType: string
  errorCode: string | null
  endedReason: string | null
}

export interface SessionUsageReport {
  summary: SessionUsageReportSummary
  topHosts: SessionUsageTopHost[]
  topUsers: SessionUsageTopUser[]
  sessions: Paginated<SessionUsageSession>
}

export interface SshTunnelReportSummary {
  totalAccesses: number
  webAccesses: number
  tunnelAccesses: number
  uniqueUsers: number
  uniqueForwardings: number
}

export interface SshTunnelTopForwarding {
  forwardingId: number | null
  label: string
  hostId: number | null
  hostName: string | null
  remoteHost: string
  remotePort: number
  count: number
}

export interface SshTunnelTopUser {
  userId: number
  userName: string
  userEmail: string
  count: number
}

export interface SshTunnelEvent {
  id: number
  userId: number
  userName: string
  userEmail: string
  forwardingId: number | null
  label: string
  hostId: number | null
  hostName: string | null
  remoteHost: string
  remotePort: number
  type: string
  timestamp: string
}

export interface SshTunnelReport {
  summary: SshTunnelReportSummary
  topForwardings: SshTunnelTopForwarding[]
  topUsers: SshTunnelTopUser[]
  events: Paginated<SshTunnelEvent>
}

export interface UserAdoptionReportSummary {
  activeUsers: number
  totalSessions: number
  totalSnippets: number
  totalSshTunnels: number
  totalLiveSessions: number
}

export interface UserAdoptionRow {
  userId: number
  userName: string
  userEmail: string
  sessions: number
  snippets: number
  sshTunnels: number
  liveSessions: number
  lastActivityAt: string | null
}

export interface UserAdoptionReport {
  summary: UserAdoptionReportSummary
  users: Paginated<UserAdoptionRow>
}

export interface ClientUxReportSummary {
  totalEvents: number
  sessionExpired: number
  sessionExpiredTerminal: number
  staleReloadRecovered: number
  staleReloadFailed: number
  uniqueUsers: number
}

export interface ClientUxActionCount {
  action: string
  count: number
}

export interface ClientUxTopUser {
  userId: number
  userName: string
  userEmail: string
  count: number
  lastEventAt: string
}

export interface ClientUxDailyRow {
  date: string
  action: string
  count: number
}

export interface ClientUxEvent {
  id: number
  userId: number
  userName: string
  userEmail: string
  action: string
  details: string | null
  timestamp: string
}

export interface ClientUxReport {
  summary: ClientUxReportSummary
  byAction: ClientUxActionCount[]
  topUsers: ClientUxTopUser[]
  daily: ClientUxDailyRow[]
  events: Paginated<ClientUxEvent>
}

export interface HostKeyReportSummary {
  totalHosts: number
  trustedHosts: number
  missingHosts: number
  trustedEvents: number
  updatedEvents: number
  uniqueHostsWithEvents: number
}

export interface HostKeyMissingHost {
  hostId: number
  hostName: string
  hostIp: string
  hostPort: number
  hostScope: string
}

export interface HostKeyEvent {
  id: number
  action: string
  timestamp: string
  userId: number
  userName: string
  userEmail: string
  hostId: number | null
  hostName: string | null
  hostIp: string | null
  hostPort: number | null
  hostScope: string | null
  hostDeleted: boolean
  previousFingerprint: string | null
  nextFingerprint: string | null
  currentFingerprint: string | null
  lastVerifiedAt: string | null
}

export interface HostKeyReport {
  summary: HostKeyReportSummary
  missingHosts: HostKeyMissingHost[]
  events: Paginated<HostKeyEvent>
}

export const reportsService = {
  getSnippetUsage(params: {
    periodDays?: number
    search?: string
    status?: string
    userId?: number
    snippetId?: number
    hostId?: number
    page?: number
    limit?: number
  }) {
    return api.get<SnippetUsageReport>('/reports/snippets', { params })
  },
  getSessionUsage(params: {
    periodDays?: number
    search?: string
    status?: string
    userId?: number
    hostId?: number
    page?: number
    limit?: number
  }) {
    return api.get<SessionUsageReport>('/reports/sessions', { params })
  },
  getSshTunnelUsage(params: {
    periodDays?: number
    search?: string
    status?: string
    userId?: number
    snippetId?: number
    hostId?: number
    page?: number
    limit?: number
  }) {
    return api.get<SshTunnelReport>('/reports/ssh-tunnels', { params })
  },
  getUserAdoption(params: {
    periodDays?: number
    search?: string
    page?: number
    limit?: number
  }) {
    return api.get<UserAdoptionReport>('/reports/adoption', { params })
  },
  getClientUx(params: {
    periodDays?: number
    search?: string
    status?: string
    userId?: number
    page?: number
    limit?: number
  }) {
    return api.get<ClientUxReport>('/reports/client-ux', { params })
  },
  getHostKeys(params: {
    periodDays?: number
    search?: string
    status?: string
    userId?: number
    hostId?: number
    page?: number
    limit?: number
  }) {
    return api.get<HostKeyReport>('/reports/host-keys', { params })
  },
}
