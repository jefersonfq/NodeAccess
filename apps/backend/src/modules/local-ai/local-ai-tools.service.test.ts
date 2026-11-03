import { describe, expect, it, vi } from 'vitest'
import { LocalAiToolsService } from './local-ai-tools.service.js'
import type { JwtPayload } from '../../shared/guards.js'
const user: JwtPayload = { sub: '9', tenantId: 7, role: 'user', email: 'fixture@example.invalid', stage: 'authenticated', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false, forcePasswordChange: false }
const admin = { ...user, role: 'admin' as const }
const date = new Date('2026-01-01T00:00:00Z')
function setup() {
  const bastion = { id: 5, name: 'Jump', ip: '192.0.2.5', port: 22, sshUser: 'jump' }
  const host = { id: 42, name: 'Fixture host', ip: '192.0.2.42', port: 22, sshUser: 'fixture', scope: 'GROUP', connectionMode: 'DIRECT', operatingSystem: 'LINUX', group: { name: 'Group' }, bastion }
  const session = { id: 51, host, user: { name: 'Fixture user' }, startedAt: date, endedAt: null, active: true }
  const audit = { sessionId: 51, hostNameSnapshot: host.name, hostIpSnapshot: host.ip, startedAt: date, endedAt: null, status: 'recorded', aiRiskLevel: 'low', aiSummaryText: 'Fixture audit', ticketProvider: 'jira', ticketKey: 'OPS-1' }
  const db = { tenant: { findUnique: vi.fn().mockResolvedValue({ name: 'Fixture tenant' }) }, host: { findMany: vi.fn().mockResolvedValue([host]), findFirst: vi.fn().mockResolvedValue(host) }, session: { count: vi.fn().mockResolvedValue(3), findMany: vi.fn().mockResolvedValue([session]), findFirst: vi.fn().mockResolvedValue(session) }, group: { findFirst: vi.fn().mockResolvedValue({ id: 4, name: 'Group', description: 'Fixture group', bastion }), findMany: vi.fn().mockResolvedValue([{ name: 'Group' }]) }, sessionAudit: { findMany: vi.fn().mockResolvedValue([audit]), findFirst: vi.fn().mockResolvedValue(audit) } }
  const entitlements = { getSnapshot: vi.fn().mockResolvedValue({ featureEntitlements: { ssh: true, disabled: false } }) }
  const knowledge = { searchReadyDocuments: vi.fn().mockResolvedValue([{ id: 1, title: 'Fixture document' }]) }
  const acl = { countHostsWithEffectivePermission: vi.fn().mockResolvedValue(2), hasEffectiveHostPermission: vi.fn().mockResolvedValue(true), findHostIdsWithEffectivePermission: vi.fn().mockResolvedValue(new Set([42])) }
  return { db, host, session, audit, acl, knowledge, service: new LocalAiToolsService(db as never, entitlements as never, knowledge as never, acl as never) }
}
describe('AI read tools scoped context', () => {
  it.each([user, admin])('builds platform snapshot with effective permission for $role', async actor => {
    const s = setup()
    expect(await s.service.getPlatformSnapshot(actor)).toEqual({ tenantName: 'Fixture tenant', enabledModules: ['ssh'], visibleHosts: 2, activeSessions: 3 })
    expect(s.acl.countHostsWithEffectivePermission).toHaveBeenCalledWith(7, 9, 'view', actor.role === 'admin' ? 'ADMIN' : 'USER')
    expect(s.db.session.count).toHaveBeenCalledWith({ where: { active: true, user: { tenantId: 7 } } })
    s.db.tenant.findUnique.mockResolvedValue(null)
    expect((await s.service.getPlatformSnapshot(actor)).tenantName).toBe('Tenant 7')
  })
  it('filters candidates before limiting search results and maps optional names', async () => {
    const s = setup(); s.db.host.findMany.mockResolvedValue([{ ...s.host, id: 43 }, s.host, { ...s.host, id: 44, group: null, bastion: null }]); s.acl.findHostIdsWithEffectivePermission.mockResolvedValue(new Set([42, 44]))
    expect(await s.service.searchHosts(user, ' fixture ', 1)).toEqual([{ id: 42, name: s.host.name, ip: s.host.ip, scope: 'GROUP', groupName: 'Group', bastionName: 'Jump' }])
    expect(s.db.host.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 7, deletedAt: null }) as unknown, take: 25 }))
    expect(s.acl.findHostIdsWithEffectivePermission).toHaveBeenCalledWith([43, 42, 44], 7, 9, 'view', 'USER')
    const result = await s.service.searchHosts(admin, 'fixture', 20)
    expect(s.db.host.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 100 }))
    expect(result[1]).toMatchObject({ id: 44, groupName: null, bastionName: null })
  })
  it('does not query or check ACL unnecessarily for blank/empty search', async () => {
    const s = setup()
    expect(await s.service.searchHosts(user, ' ')).toEqual([]); expect(s.db.host.findMany).not.toHaveBeenCalled()
    s.db.host.findMany.mockResolvedValue([]); expect(await s.service.searchHosts(user, 'fixture')).toEqual([]); expect(s.acl.findHostIdsWithEffectivePermission).not.toHaveBeenCalled()
  })
  it.each([user, admin])('limits recent and explicit sessions to authorized scope for $role', async actor => {
    const s = setup(), scope = actor.role === 'admin' ? { user: { tenantId: 7 } } : { userId: 9 }
    expect(await s.service.listRecentSessions(actor, 2)).toEqual([{ id: 51, hostName: s.host.name, hostIp: s.host.ip, startedAt: date, active: true }])
    expect(s.db.session.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: scope, take: 2 }))
    expect(await s.service.getSessionSummary(actor, 51)).toMatchObject({ id: 51, userName: 'Fixture user', hostName: s.host.name, endedAt: null })
    expect(s.db.session.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 51, ...scope } }))
    s.db.session.findFirst.mockResolvedValue(null); expect(await s.service.getSessionSummary(actor, 999)).toBeNull()
  })
  it.each([user, admin])('checks host view ACL before session context for $role', async actor => {
    const s = setup(), scope = actor.role === 'admin' ? { user: { tenantId: 7 } } : { userId: 9 }
    const result = await s.service.getHostSummary(actor, 42)
    expect(result).toMatchObject({ id: 42, groupName: 'Group', bastionName: 'Jump', operatingSystem: 'LINUX', recentSessions: [{ id: 51, startedAt: date, active: true, userName: 'Fixture user' }] })
    expect(s.db.host.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42, tenantId: 7, deletedAt: null } }))
    expect(s.db.session.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { hostId: 42, ...scope }, take: 3 }))
    s.db.session.findMany.mockClear(); s.acl.hasEffectiveHostPermission.mockResolvedValue(false)
    expect(await s.service.getHostSummary(actor, 42)).toBeNull(); expect(s.db.session.findMany).not.toHaveBeenCalled()
    s.db.host.findFirst.mockResolvedValue(null); expect(await s.service.getHostSummary(actor, 999)).toBeNull()
  })
  it('maps absent host group/bastion without inventing labels', async () => {
    const s = setup(); s.db.host.findFirst.mockResolvedValue({ ...s.host, group: null, bastion: null }); s.db.session.findMany.mockResolvedValue([])
    expect(await s.service.getHostSummary(user, 42)).toMatchObject({ groupName: null, bastionName: null, recentSessions: [] })
  })
  it.each([user, admin])('scopes group membership and host ACL for $role', async actor => {
    const s = setup(); s.db.host.findMany.mockResolvedValue([s.host, { ...s.host, id: 43 }])
    const result = await s.service.getGroupSummary(actor, ' Group ')
    expect(result?.visibleHosts).toEqual([s.host]); expect(result?.bastionName).toBe('Jump')
    expect(s.db.group.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 7, name: { contains: 'Group' }, ...(actor.role === 'admin' ? {} : { users: { some: { userId: 9 } } }) } }))
    expect(s.db.host.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 7, deletedAt: null, groupId: 4 }, take: 50 }))
    s.db.group.findFirst.mockResolvedValue(null); expect(await s.service.getGroupSummary(actor, 'missing')).toBeNull()
    s.db.group.findFirst.mockClear(); expect(await s.service.getGroupSummary(actor, ' ')).toBeNull(); expect(s.db.group.findFirst).not.toHaveBeenCalled()
  })
  it('reveals bastion only through permitted hosts and scopes related groups', async () => {
    const s = setup()
    const result = await s.service.getBastionSummary(user, ' Jump ')
    expect(result).toMatchObject({ id: 5, name: 'Jump', relatedGroups: ['Group'], visibleHosts: [{ id: 42, name: s.host.name, ip: s.host.ip, scope: 'GROUP', groupName: 'Group' }] })
    expect(s.db.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 7, bastionId: 5 }, take: 5 }))
    s.db.group.findMany.mockClear(); s.acl.findHostIdsWithEffectivePermission.mockResolvedValue(new Set())
    expect(await s.service.getBastionSummary(user, 'Jump')).toBeNull(); expect(s.db.group.findMany).not.toHaveBeenCalled()
    s.db.host.findMany.mockClear(); expect(await s.service.getBastionSummary(user, ' ')).toBeNull(); expect(s.db.host.findMany).not.toHaveBeenCalled()
  })
  it.each([user, admin])('scopes audit search, session and ticket summaries for $role', async actor => {
    const s = setup(), scope = { tenantId: 7, ...(actor.role === 'admin' ? {} : { userId: 9 }) }
    const result = await s.service.searchSessionAudits(actor, ' fixture ', 2)
    expect(result).toEqual([{ sessionId: 51, hostName: s.host.name, hostIp: s.host.ip, startedAt: date, status: 'recorded', riskLevel: 'low', summary: 'Fixture audit' }])
    expect(s.db.sessionAudit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining(scope) as unknown, take: 2 }))
    expect(await s.service.getSessionAuditSummary(actor, 51)).toMatchObject({ sessionId: 51, endedAt: null, summary: 'Fixture audit' })
    expect(s.db.sessionAudit.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { ...scope, sessionId: 51 } }))
    expect(await s.service.getTicketAuditSummary(actor, ' ops-1 ')).toMatchObject({ ticketKey: 'OPS-1', ticketProvider: 'jira' })
    expect(s.db.sessionAudit.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { ...scope, ticketKey: 'OPS-1' }, orderBy: { startedAt: 'desc' } }))
    s.db.sessionAudit.findFirst.mockResolvedValue(null)
    expect(await s.service.getSessionAuditSummary(actor, 999)).toBeNull(); expect(await s.service.getTicketAuditSummary(actor, 'OPS-404')).toBeNull()
  })
  it('short-circuits empty audit/ticket search and delegates knowledge with tenant/limit', async () => {
    const s = setup()
    expect(await s.service.searchSessionAudits(user, ' ')).toEqual([]); expect(await s.service.getTicketAuditSummary(user, ' ')).toBeNull()
    expect(s.db.sessionAudit.findMany).not.toHaveBeenCalled(); expect(s.db.sessionAudit.findFirst).not.toHaveBeenCalled()
    expect(await s.service.searchKnowledgeBase(user, 'fixture', 2)).toEqual([{ id: 1, title: 'Fixture document' }])
    expect(s.knowledge.searchReadyDocuments).toHaveBeenCalledWith(7, 'fixture', 2)
  })
})
