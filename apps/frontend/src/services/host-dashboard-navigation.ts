import type { HostDashboard, HostDashboardPeriodDays } from '@nodeaccess/shared'
import type { RouteLocationRaw } from 'vue-router'

export function hostAttentionLinks(dashboard: HostDashboard, periodDays: HostDashboardPeriodDays): { label: string; route: RouteLocationRaw }[] {
  if (dashboard.viewer.role !== 'admin') return []
  const query = { hostId: String(dashboard.host.id), periodDays: String(periodDays) }
  const links: { label: string; route: RouteLocationRaw }[] = []
  if (dashboard.summary.failedSessions > 0) links.push({ label: `${dashboard.summary.failedSessions} sessão(ões) com falha`, route: { name: 'admin-reports-sessions', query: { ...query, hasError: 'true' } } })
  if (dashboard.auditPosture.failed > 0) links.push({ label: `${dashboard.auditPosture.failed} auditoria(s) com falha`, route: { name: 'admin-session-audit', query: { ...query, status: 'FAILED' } } })
  if (dashboard.auditPosture.riskHigh > 0) links.push({ label: `${dashboard.auditPosture.riskHigh} auditoria(s) com risco alto`, route: { name: 'admin-session-audit', query: { ...query, aiRiskLevel: 'high' } } })
  if (dashboard.summary.webForwardings > 0) links.push({ label: `${dashboard.summary.webForwardings} forwarding(s) web`, route: { name: 'forwardings', query: { hostId: query.hostId } } })
  return links
}
