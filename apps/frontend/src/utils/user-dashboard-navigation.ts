import type { RouteLocationRaw } from 'vue-router'
import type { UserDashboardPeriodDays, UserDashboardTimelineItem } from '@nodeaccess/shared'

type SessionReportContext = {
  userId: number
  hostId?: number
  periodDays?: UserDashboardPeriodDays
  date?: string
  hasError?: boolean
}

function reportDayRange(date?: string) {
  if (!date) return { dateFrom: undefined, dateTo: undefined }
  const dateFrom = `${date}T00:00:00.000Z`
  const nextDay = new Date(dateFrom)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  return { dateFrom, dateTo: nextDay.toISOString() }
}

export function buildSessionReportRoute(context: SessionReportContext): RouteLocationRaw {
  const dayRange = reportDayRange(context.date)
  return {
    name: 'admin-reports-sessions',
    query: {
      userId: String(context.userId),
      hostId: context.hostId ? String(context.hostId) : undefined,
      periodDays: context.date ? undefined : context.periodDays ? String(context.periodDays) : undefined,
      dateFrom: dayRange.dateFrom,
      dateTo: dayRange.dateTo,
      hasError: context.hasError === undefined ? undefined : String(context.hasError),
      source: 'user-dashboard',
    },
  }
}

export function buildTimelineReportRoute(
  item: UserDashboardTimelineItem,
  userId: number,
  userEmail?: string,
): RouteLocationRaw {
  if (item.type === 'auth') {
    return {
      name: 'admin-logs',
      query: {
        tab: 'auth',
        search: userEmail,
        source: 'user-dashboard',
      },
    }
  }

  if (item.type === 'audit' && item.sessionId) {
    return {
      name: 'admin-session-audit-detail',
      params: { sessionId: String(item.sessionId) },
      query: { source: 'user-dashboard' },
    }
  }

  return buildSessionReportRoute({
    userId,
    date: new Date(item.occurredAt).toISOString().slice(0, 10),
    hasError: item.severity === 'error' ? true : undefined,
  })
}
