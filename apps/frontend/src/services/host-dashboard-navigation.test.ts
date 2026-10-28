import { describe, expect, it } from 'vitest'
import type { HostDashboard } from '@nodeaccess/shared'
import { hostAttentionLinks } from './host-dashboard-navigation'
const dashboard = { host: { id: 41 }, viewer: { role: 'admin' }, summary: { failedSessions: 2, webForwardings: 1 }, auditPosture: { failed: 3, riskHigh: 4 } } as HostDashboard
describe('host attention drilldowns', () => {
  it('preserves the host, period and corresponding failure/risk filter', () => {
    const links = hostAttentionLinks(dashboard, 7)
    expect(links.map(link => link.route)).toEqual([
      { name: 'admin-reports-sessions', query: { hostId: '41', periodDays: '7', hasError: 'true' } },
      { name: 'admin-session-audit', query: { hostId: '41', periodDays: '7', status: 'FAILED' } },
      { name: 'admin-session-audit', query: { hostId: '41', periodDays: '7', aiRiskLevel: 'high' } },
      { name: 'forwardings', query: { hostId: '41' } },
    ])
  })
  it('does not advertise administrative drilldowns to a restricted user', () => {
    expect(hostAttentionLinks({ ...dashboard, viewer: { ...dashboard.viewer, role: 'user' } }, 30)).toEqual([])
  })
  it('omits criteria that are not present instead of matching translated reason text', () => {
    expect(hostAttentionLinks({ ...dashboard, summary: { ...dashboard.summary, failedSessions: 0, webForwardings: 0 }, auditPosture: { ...dashboard.auditPosture, failed: 0, riskHigh: 0 } }, 15)).toEqual([])
  })
})
