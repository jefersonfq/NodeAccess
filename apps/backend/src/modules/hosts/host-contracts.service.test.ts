import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateHostSchema } from '@nodeaccess/shared'
import { decrypt } from '../../shared/crypto.js'
import type { HostAssociatedLink } from '@nodeaccess/shared'
import { HostService } from './host.service.js'
import type { HostRepository, HostRow } from './host.repository.js'

const time = new Date('2026-01-01T00:00:00Z')
function fixture() {
  const host = { id: 10, tenantId: 1, name: 'Fixture host', ip: '192.0.2.10', port: 22, sshUser: 'operator',
    authType: 'PASSWORD', scope: 'GLOBAL', connectionMode: 'DIRECT', accessProtocol: 'SSH', tags: [{ tag: { id: 2, name: 'Fixture', color: '#fff' } }],
    bastion: null, group: null, ownerId: null, groupId: null, folderId: null, bastionId: null, pemKeyId: null,
    passwordEncrypted: null, onePasswordRef: null, trustedHostKeyFingerprint: null, createdAt: time } as unknown as HostRow
  const repo = {
    countByTenant: vi.fn().mockResolvedValue(0), defaultDeviceProfile: vi.fn().mockResolvedValue('server_ssh'),
    create: vi.fn((data: Parameters<HostRepository['create']>[0]) => Promise.resolve({ ...host, ...data } as HostRow)),
    findByIdForUser: vi.fn().mockResolvedValue(null), findBastionProfileIdBySourceHost: vi.fn().mockResolvedValue(null),
    inventoryFolderAclSummary: vi.fn().mockResolvedValue({ name: 'Fixture folder', aclEntries: 1 }),
    hasActiveSessions: vi.fn().mockResolvedValue(false), delete: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn((id: number, tenant: number) => Promise.resolve(id === 10 && tenant === 1 ? host : null)),
    findImportDuplicates: vi.fn().mockResolvedValue([]), getSidebarSummary: vi.fn().mockResolvedValue({ total: 3, personal: 1, team: 1, global: 1 }),
    findHostLicenseLimit: vi.fn().mockResolvedValue(10), listVisibleAssociatedLinksCatalog: vi.fn().mockResolvedValue([]),
    countActiveSessions: vi.fn().mockResolvedValue(0), listAssociatedLinksByHostIds: vi.fn().mockResolvedValue(new Map()),
    trustHostKey: vi.fn((_id: number, _tenant: number, fingerprint: string) => Promise.resolve({ ...host, trustedHostKeyFingerprint: fingerprint })),
    update: vi.fn((_id: number, _tenant: number, patch: Parameters<HostRepository['update']>[2]) => Promise.resolve({ ...host, ...patch } as HostRow)),
  }
  const ssh = { getEffectiveHostPermissionSets: vi.fn().mockResolvedValue(new Map([[10, { view: true, connect: true, edit: true, admin: false }]])) }
  const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined), findRecentAdminEventsByTarget: vi.fn().mockResolvedValue([]) }
  const vault = { resolve: vi.fn<(tenant: number, ref: string) => Promise<string>>().mockResolvedValue('["https://host.example.test/{{HOST.IP}}"]') }
  const webhook = { publishEvent: vi.fn().mockResolvedValue(undefined) }
  const redis = { del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') }
  const service = new HostService(repo as unknown as HostRepository, ssh as never, logs as never, vault as never,
    webhook as never, redis as never)
  return { host, repo, ssh, logs, vault, redis, webhook, service }
}
beforeEach(() => { vi.restoreAllMocks() })

describe('host lookup and cache contracts', () => {
  it('normalizes imported endpoint protocols while preserving tenant and endpoint identity', async () => {
    const s = fixture(), endpoints = [{ ip: '192.0.2.10', port: 22, sshUser: 'operator', accessProtocol: 'ssh' as const }, { ip: '192.0.2.11', port: 3389, sshUser: '', accessProtocol: 'rdp' as const }]
    await s.service.findImportDuplicates(1, endpoints)
    expect(s.repo.findImportDuplicates).toHaveBeenCalledWith(1, [{ ...endpoints[0], accessProtocol: 'SSH' }, { ...endpoints[1], accessProtocol: 'RDP' }])
    expect(endpoints[0]!.accessProtocol).toBe('ssh')
  })
  it('loads a scoped sidebar summary and caches it separately for each tenant/user', async () => {
    const s = fixture()
    expect(await s.service.getSidebarSummary(1, 7, 'USER')).toEqual({ total: 3, personal: 1, team: 1, global: 1, maxHosts: 10 })
    expect(s.redis.get).toHaveBeenCalledWith('hosts:sidebar:1:7')
    expect(s.repo.getSidebarSummary).toHaveBeenCalledWith(1, 7, 'USER')
    expect(s.repo.findHostLicenseLimit).toHaveBeenCalledWith(1)
    expect(s.redis.set).toHaveBeenCalledWith('hosts:sidebar:1:7', JSON.stringify({ total: 3, personal: 1, team: 1, global: 1, maxHosts: 10 }), 'EX', 30)
    await s.service.getSidebarSummary(2, 8, 'ADMIN')
    expect(s.redis.get).toHaveBeenLastCalledWith('hosts:sidebar:2:8')
  })
  it('uses a valid cache without requerying repository and tolerates Redis I/O failure', async () => {
    const s = fixture(); s.redis.get.mockResolvedValueOnce('{"total":9,"maxHosts":20}')
    expect(await s.service.getSidebarSummary(1, 7, 'USER')).toEqual({ total: 9, maxHosts: 20 })
    expect(s.repo.getSidebarSummary).not.toHaveBeenCalled()
    s.redis.get.mockRejectedValueOnce(new Error('cache read unavailable')); s.redis.set.mockRejectedValueOnce(new Error('cache write unavailable'))
    expect((await s.service.getSidebarSummary(1, 7, 'USER')).maxHosts).toBe(10)
  })
  it('returns only repository-authorized associated links with explicit host identity', async () => {
    const s = fixture()
    s.repo.listVisibleAssociatedLinksCatalog.mockResolvedValue([{ hostId: 10, hostName: 'Fixture host', hostIp: '192.0.2.10', hostPort: 22, hostSshUser: 'operator', id: 3, label: 'Console', urlTemplate: 'https://console.example.test', position: 0, enabled: 1, openMode: 'new_tab', sourceType: 'manual', sourceProvider: null, sourceRef: null, sourceStatus: 'local', sourceUpdatedAt: null }])
    const result = await s.service.listAssociatedLinksCatalog(1, 7, 'USER')
    expect(s.repo.listVisibleAssociatedLinksCatalog).toHaveBeenCalledWith(1, 7, 'USER')
    expect(result).toMatchObject([{ host: { id: 10, name: 'Fixture host', ip: '192.0.2.10', port: 22, sshUser: 'operator' }, link: { id: 3, enabled: true, label: 'Console' } }])
  })
  it('delete check requires edit access and reports active-session blockers without deleting', async () => {
    const s = fixture()
    expect(await s.service.getDeleteCheck(10, 1, 7, 'USER')).toEqual({ canDelete: true, blockers: { sessions: 0, sessionAudits: 0, mcpInteractiveSessions: 0 } })
    s.repo.countActiveSessions.mockResolvedValue(2)
    expect((await s.service.getDeleteCheck(10, 1, 7, 'USER')).canDelete).toBe(false)
    s.ssh.getEffectiveHostPermissionSets.mockResolvedValue(new Map())
    await expect(s.service.getDeleteCheck(10, 1, 7, 'USER')).rejects.toThrow('Sem permissão')
    await expect(s.service.getDeleteCheck(10, 99, 7, 'ADMIN')).rejects.toThrow('não encontrado')
  })
})

describe('host key trust and history', () => {
  it.each([null, 'SHA256:previous'])('persists explicit key approval and distinguishes previous fingerprint %s', async previous => {
    const s = fixture(); s.host.trustedHostKeyFingerprint = previous
    s.logs.logAdminEvent.mockRejectedValueOnce(new Error('audit unavailable'))
    const result = await s.service.trustHostKey(10, { fingerprint: 'SHA256:new' }, 1, 7, 'USER', false)
    expect(s.repo.trustHostKey).toHaveBeenCalledWith(10, 1, 'SHA256:new', 7)
    expect(result.trustedHostKeyFingerprint).toBe('SHA256:new')
    expect(result.tags).toEqual([{ id: 2, name: 'Fixture', color: '#fff' }])
    expect(s.logs.logAdminEvent).toHaveBeenCalledWith({ adminId: 7, action: previous ? 'HOST_KEY_UPDATED' : 'HOST_KEY_TRUSTED', targetType: 'Host', targetId: 10, details: JSON.stringify({ previousFingerprint: previous, nextFingerprint: 'SHA256:new' }) })
  })
  it('blocks trust and history across tenants and without effective edit permission', async () => {
    const s = fixture(); s.ssh.getEffectiveHostPermissionSets.mockResolvedValue(new Map([[10, { view: true, edit: false }]]))
    await expect(s.service.trustHostKey(10, { fingerprint: 'SHA256:new' }, 1, 7, 'USER', true)).rejects.toThrow('Sem permissão')
    await expect(s.service.listHostKeyHistory(10, 1, 7, 'USER')).rejects.toThrow('Sem permissão')
    await expect(s.service.trustHostKey(10, { fingerprint: 'SHA256:new' }, 99, 7, 'ADMIN', true)).rejects.toThrow('não encontrado')
    await expect(s.service.listHostKeyHistory(10, 99, 7, 'ADMIN')).rejects.toThrow('não encontrado')
    expect(s.repo.trustHostKey).not.toHaveBeenCalled(); expect(s.logs.findRecentAdminEventsByTarget).not.toHaveBeenCalled()
  })
  it('reads bounded scoped history and safely handles malformed historical details', async () => {
    const s = fixture()
    const details = ['{"previousFingerprint":"old","nextFingerprint":"new"}', null, '{broken', 'null', '3', '{"nextFingerprint":7}', '[]']
    s.logs.findRecentAdminEventsByTarget.mockResolvedValue(details.map(value => ({ action: 'HOST_KEY_UPDATED', admin: { name: 'Fixture admin' }, timestamp: time, details: value })))
    const result = await s.service.listHostKeyHistory(10, 1, 7, 'ADMIN')
    expect(s.logs.findRecentAdminEventsByTarget).toHaveBeenCalledWith(1, 'Host', 10, ['HOST_KEY_TRUSTED', 'HOST_KEY_UPDATED'], 10)
    expect(result[0]).toEqual({ action: 'HOST_KEY_UPDATED', adminName: 'Fixture admin', previousFingerprint: 'old', nextFingerprint: 'new', timestamp: time })
    for (const row of result.slice(1)) expect(row).toMatchObject({ previousFingerprint: null, nextFingerprint: null })
  })
})

describe('associated links from vault', () => {
  it('previews mixed supported formats, substitutes only supported legacy tokens, and never writes', async () => {
    const s = fixture()
    s.vault.resolve.mockResolvedValue(JSON.stringify({ links: [
      'https://example.test/{{HOST:ID}}/{{HOST:NAME}}/{{HOST:IP}}/{{HOST:PORT}}/{{HOST:SSH_USER}}',
      { label: 'A', urlTemplate: 'https://a.example.test', enabled: false, openMode: 'same_tab' },
      { title: 'B', url: 'https://b.example.test', open_mode: 'same_tab' },
      { name: 'C', url_template: 'http://c.example.test' },
      { url: 'https://d.example.test' },
    ] }))
    const result = await s.service.previewAssociatedLinksFromOnePassword(10, 'op://fixture/links', 1, 7, 'USER')
    expect(result.map(link => link.label)).toEqual(['Link 1', 'A', 'B', 'C', 'Link 5'])
    expect(result.map(link => link.openMode)).toEqual(['new_tab', 'same_tab', 'same_tab', 'new_tab', 'new_tab'])
    expect(result[1]!.enabled).toBe(false)
    expect(result[0]!.urlTemplate).toContain('{{HOST:ID}}') // Validation does not mutate source template.
    for (const link of result) expect(link).toMatchObject({ sourceType: 'integration', sourceProvider: 'onepassword', sourceRef: 'op://fixture/links', sourceStatus: 'synced' })
    for (const link of result) expect(link.sourceUpdatedAt).toBeInstanceOf(Date)
    expect(s.vault.resolve).toHaveBeenCalledWith(1, 'op://fixture/links'); expect(s.repo.update).not.toHaveBeenCalled()
  })
  it('replaces only prior 1Password links, preserves manual/other-provider entries and reindexes positions', async () => {
    const s = fixture()
    const link = (sourceType: 'manual' | 'integration', sourceProvider: string | null, label: string) => ({ label, urlTemplate: 'https://example.test', position: 9, enabled: true, openMode: 'new_tab', sourceType, sourceProvider, sourceRef: null, sourceStatus: 'local', sourceUpdatedAt: null }) as HostAssociatedLink
    const manual = link('manual', null, 'manual'), other = link('integration', 'other', 'other'), old = link('integration', 'onepassword', 'old')
    s.repo.listAssociatedLinksByHostIds.mockResolvedValue(new Map([[10, [manual, old, other]]]))
    s.logs.logAdminEvent.mockRejectedValueOnce(new Error('audit unavailable'))
    await s.service.importAssociatedLinksFromOnePassword(10, 'op://fixture/links', 1, 7, 'USER')
    const patch = s.repo.update.mock.calls[0]![2]
    expect(patch.associatedLinks?.map(item => item.label)).toEqual(['manual', 'other', 'Link 1'])
    expect(patch.associatedLinks?.map(item => item.position)).toEqual([0, 1, 2])
    expect(s.repo.update).toHaveBeenCalledWith(10, 1, expect.any(Object))
    expect(s.logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'IMPORT_HOST_ASSOCIATED_LINKS_ONEPASSWORD', details: JSON.stringify({ ref: 'op://fixture/links', imported: 1 }) }))
  })
  it.each([
    ['', 'JSON válido'], ['x'.repeat(300), 'JSON válido'], ['null', 'array de links'], ['{}', 'array de links'],
    ['[null]', 'string ou objeto'], ['[5]', 'string ou objeto'], ['[{}]', 'url/urlTemplate'],
    ['["javascript:alert(1)"]', 'http:// ou https://'], ['["https://example.test/{{SECRET}}"]', 'Placeholder inválido'],
    ['["http://[invalid"]', 'URL inválida'],
  ])('rejects invalid vault payload before persistence: %s', async (raw, message) => {
    const s = fixture(); s.vault.resolve.mockResolvedValue(raw)
    await expect(s.service.importAssociatedLinksFromOnePassword(10, 'op://fixture/links', 1, 7, 'ADMIN')).rejects.toThrow(message)
    expect(s.repo.update).not.toHaveBeenCalled()
  })
  it('blocks foreign-tenant and non-editor preview/import before retrieving vault content', async () => {
    const s = fixture(); s.ssh.getEffectiveHostPermissionSets.mockResolvedValue(new Map())
    for (const operation of ['importAssociatedLinksFromOnePassword', 'previewAssociatedLinksFromOnePassword'] as const) {
      await expect(s.service[operation](10, 'op://fixture/links', 99, 7, 'ADMIN')).rejects.toThrow()
      await expect(s.service[operation](10, 'op://fixture/links', 1, 7, 'USER')).rejects.toThrow('Sem permissão')
    }
    expect(s.vault.resolve).not.toHaveBeenCalled(); expect(s.repo.update).not.toHaveBeenCalled()
  })
  it('propagates vault failures without partial updates', async () => {
    const s = fixture(); s.vault.resolve.mockRejectedValue(new Error('vault unavailable'))
    await expect(s.service.importAssociatedLinksFromOnePassword(10, 'op://fixture/links', 1, 7, 'USER')).rejects.toThrow('vault unavailable')
    expect(s.repo.update).not.toHaveBeenCalled()
  })
})


describe('host lifecycle best-effort side effects', () => {
  it('preserves committed host changes when audit, webhook and cache invalidation are unavailable', async () => {
    const s = fixture()
    s.logs.logAdminEvent.mockRejectedValue(new Error('audit unavailable'))
    s.webhook.publishEvent.mockRejectedValue(new Error('webhook unavailable'))
    s.redis.del.mockRejectedValue(new Error('cache unavailable'))
    const dto = CreateHostSchema.parse({ name: 'Created fixture', ip: '192.0.2.20', port: 22, sshUser: 'operator',
      scope: 'global', authType: 'password', connectionMode: 'direct', inventoryParentId: 20, password: 'Synthetic123!' })
    const created = await s.service.create(dto, 1, 7, 'ADMIN')
    expect(created.name).toBe('Created fixture')
    const persisted = s.repo.create.mock.calls[0]![0]
    expect(decrypt(JSON.parse(persisted.passwordEncrypted!) as { encrypted: string; iv: string })).toBe('Synthetic123!')
    expect(JSON.stringify(s.logs.logAdminEvent.mock.calls)).not.toContain('Synthetic123!')
    await expect(s.service.update(10, { name: 'Moved', inventoryParentId: 20 }, 1, 7, 'ADMIN')).resolves.toMatchObject({ name: 'Moved' })
    s.host.inventoryNode = { id: 11, parentId: 20, parent: { name: 'Fixture folder' } } as never
    await expect(s.service.update(10, { inventoryParentId: null }, 1, 7, 'ADMIN')).resolves.toHaveProperty('id', 10)
    await expect(s.service.delete(10, 1, 7, 'ADMIN')).resolves.toBeUndefined()
    expect(s.repo.delete).toHaveBeenCalledWith(10)
    expect(s.logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'INVENTORY_ACL_HOSTS_MOVED' }))
    expect(s.logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'INVENTORY_ACL_HOST_UNLINKED' }))
    expect(s.webhook.publishEvent).toHaveBeenCalledTimes(4)
    expect(s.redis.del).toHaveBeenCalledWith('hosts:sidebar:1:7')
  })
})
