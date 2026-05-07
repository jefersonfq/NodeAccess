import api from './api'
import type { GroupPublic, HostPublic, CreateHostDto, HostBulkActionHistoryResponse, HostBulkApplyDto, HostBulkApplyResponse, HostBulkPreviewDto, HostBulkPreviewResponse, HostKeyTrustEvent, TagPublic, TestConnectionDto, TestConnectionResult, TrustHostKeyDto } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'
import { cacheTtls } from './cache-ttl.service'
import { createKeyedTimedPromiseCache, createTimedPromiseCache } from './service-cache'
import type { FolderPublic } from './folder.service'

interface HostQuery {
  page?: number
  limit?: number
  search?: string
  scope?: string
  groupId?: number
  folderId?: number
  tagId?: number
  unfiled?: boolean
  bastionId?: number | null
  pemKeyId?: number | null
  authType?: string
  accessProtocol?: string
  connectionMode?: string
}
interface HostDeleteCheck {
  canDelete: boolean
  blockers: {
    sessions: number
    sessionAudits: number
    mcpInteractiveSessions: number
  }
}
export interface HostSidebarSummary {
  all: number
  global: number
  unfiled: number
  maxHosts: number | null
  folders: Record<string, number>
  groups: Record<string, number>
  tags: Record<string, number>
}
export interface HostSidebarBootstrap {
  summary: HostSidebarSummary
  folders: FolderPublic[]
  groups: GroupPublic[]
  tags: TagPublic[]
}
type ImportHostAssociatedLinksFromOnePasswordDto = { ref: string }
type PreviewHostAssociatedLinksFromOnePasswordResponse = { links: HostPublic['associatedLinks'] }
export type HostAssociatedLinkCatalogItem = {
  host: Pick<HostPublic, 'id' | 'name' | 'ip' | 'port' | 'sshUser'>
  link: NonNullable<HostPublic['associatedLinks']>[number]
}
type UpdateHostDto = Omit<Partial<CreateHostDto>, 'folderId' | 'bastionId' | 'pemKeyId' | 'onePasswordRef'> & {
  folderId?: number | null
  bastionId?: number | null
  pemKeyId?: number | null
  onePasswordRef?: string | null
}

const hostListCache = createKeyedTimedPromiseCache<HostQuery | undefined, { data: Paginated<HostPublic> }>(
  cacheTtls.hostsList,
  (params) => JSON.stringify({
    page: params?.page ?? 1,
    limit: params?.limit ?? 200,
    search: params?.search ?? '',
    scope: params?.scope ?? '',
    groupId: params?.groupId ?? null,
    folderId: params?.folderId ?? null,
    tagId: params?.tagId ?? null,
    unfiled: params?.unfiled ?? false,
    bastionId: params?.bastionId ?? null,
    pemKeyId: params?.pemKeyId ?? null,
    authType: params?.authType ?? '',
    accessProtocol: params?.accessProtocol ?? '',
    connectionMode: params?.connectionMode ?? '',
  }),
  {
    name: 'hosts:list',
    maxEntries: 12,
    describeKey: (params?: HostQuery) => {
      const parts = [
        `page ${params?.page ?? 1}`,
        `limit ${params?.limit ?? 200}`,
      ]
      if (params?.search) parts.push(`busca "${params.search}"`)
      if (params?.scope) parts.push(`scope ${params.scope}`)
      if (params?.groupId) parts.push(`grupo ${params.groupId}`)
      if (params?.folderId) parts.push(`pasta ${params.folderId}`)
      if (params?.tagId) parts.push(`tag ${params.tagId}`)
      if (params?.unfiled) parts.push('sem pasta')
      if (params?.bastionId !== undefined) parts.push(`bastion ${params.bastionId ?? 'nenhum'}`)
      if (params?.pemKeyId !== undefined) parts.push(`pem ${params.pemKeyId ?? 'nenhuma'}`)
      if (params?.authType) parts.push(`auth ${params.authType}`)
      if (params?.accessProtocol) parts.push(`protocolo ${params.accessProtocol}`)
      if (params?.connectionMode) parts.push(`conexao ${params.connectionMode}`)
      return parts.join(' · ')
    },
  },
)
const hostDetailCache = createKeyedTimedPromiseCache<number, { data: HostPublic }>(cacheTtls.hostsDetail, (id) => String(id), { name: 'hosts:detail' })
const hostSidebarSummaryCache = createTimedPromiseCache<{ data: HostSidebarSummary }>(cacheTtls.hostsSidebarSummary, { name: 'hosts:sidebar-summary' })
const hostSidebarBootstrapCache = createTimedPromiseCache<{ data: HostSidebarBootstrap }>(cacheTtls.hostsSidebarBootstrap, { name: 'hosts:sidebar-bootstrap' })
const hostAssociatedLinksCatalogCache = createTimedPromiseCache<{ data: HostAssociatedLinkCatalogItem[] }>(cacheTtls.hostsList, { name: 'hosts:associated-links-catalog' })
const hostByIdsCache = createKeyedTimedPromiseCache<string, { data: HostPublic[] }>(
  cacheTtls.hostsByIds,
  (key) => key,
  { name: 'hosts:by-ids', maxEntries: 20 },
)

function isDefaultHostListQuery(params?: HostQuery) {
  return (params?.page ?? 1) === 1
    && (params?.limit ?? 200) === 200
    && !params?.search
    && !params?.scope
    && !params?.groupId
    && !params?.folderId
    && !params?.tagId
    && !params?.unfiled
}

async function updateDefaultHostList(record: HostPublic | null, mode: 'upsert' | 'remove') {
  await hostListCache.update(undefined, (current) => {
    if (!current || !isDefaultHostListQuery(undefined) || !record) return current
    const list = current.data.data
    if (mode === 'remove') {
      return {
        data: {
          ...current.data,
          data: list.filter((item) => item.id !== record.id),
          total: Math.max(0, current.data.total - (list.some((item) => item.id === record.id) ? 1 : 0)),
        },
      }
    }

    const exists = list.some((item) => item.id === record.id)
    return {
      data: {
        ...current.data,
        data: exists
          ? list.map((item) => item.id === record.id ? record : item)
          : [record, ...list],
        total: exists ? current.data.total : current.data.total + 1,
      },
    }
  })
}

export const hostService = {
  list:           (params?: HostQuery) => hostListCache.get(params, () => api.get<Paginated<HostPublic>>('/hosts', { params })),
  peekList:       (params?: HostQuery) => hostListCache.getCached(params),
  getSidebarSummary: () => hostSidebarSummaryCache.get(() => api.get<HostSidebarSummary>('/hosts/sidebar-summary')),
  getSidebarBootstrap: () => hostSidebarBootstrapCache.get(() => api.get<HostSidebarBootstrap>('/hosts/sidebar-bootstrap')),
  listAssociatedLinksCatalog: () => hostAssociatedLinksCatalogCache.get(() => api.get<HostAssociatedLinkCatalogItem[]>('/hosts/associated-links/catalog')),
  listVisibleByIds: (ids: number[]) => {
    const normalized = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0)
    const key = normalized.join(',')
    return hostByIdsCache.get(key, () => api.get<HostPublic[]>('/hosts/by-ids', { params: { ids: key } }))
  },
  get:            (id: number)         => hostDetailCache.get(id, () => api.get<HostPublic>(`/hosts/${id}`)),
  getDeleteCheck: (id: number)         => api.get<HostDeleteCheck>(`/hosts/${id}/delete-check`),
  create:         (dto: CreateHostDto) => api.post<HostPublic>('/hosts', dto).then(async (res) => {
    hostDetailCache.set(res.data.id, { data: res.data })
    hostSidebarSummaryCache.clear('host:create')
    hostSidebarBootstrapCache.clear('host:create')
    hostAssociatedLinksCatalogCache.clear('host:create')
    hostByIdsCache.clear(undefined, 'host:create')
    await updateDefaultHostList(res.data, 'upsert')
    return res
  }),
  update:         (id: number, dto: UpdateHostDto) => api.patch<HostPublic>(`/hosts/${id}`, dto).then(async (res) => {
    hostDetailCache.set(id, { data: res.data })
    hostListCache.clear(undefined, 'host:update')
    hostSidebarSummaryCache.clear('host:update')
    hostSidebarBootstrapCache.clear('host:update')
    hostAssociatedLinksCatalogCache.clear('host:update')
    hostByIdsCache.clear(undefined, 'host:update')
    await updateDefaultHostList(res.data, 'upsert')
    return res
  }),
  delete:         (id: number)         => api.delete(`/hosts/${id}`).then(async (res) => {
    await updateDefaultHostList({ id } as HostPublic, 'remove')
    hostDetailCache.clear(id, 'host:delete')
    hostSidebarSummaryCache.clear('host:delete')
    hostSidebarBootstrapCache.clear('host:delete')
    hostAssociatedLinksCatalogCache.clear('host:delete')
    hostByIdsCache.clear(undefined, 'host:delete')
    return res
  }),
  testConnection: (dto: TestConnectionDto) => api.post<TestConnectionResult>('/hosts/test-connection', dto),
  trustHostKey:   (id: number, dto: TrustHostKeyDto) => api.post<HostPublic>(`/hosts/${id}/trust-host-key`, dto).then(async (res) => {
    hostDetailCache.set(id, { data: res.data })
    await updateDefaultHostList(res.data, 'upsert')
    return res
  }),
  listHostKeyHistory: (id: number) => api.get<HostKeyTrustEvent[]>(`/hosts/${id}/host-key-history`),
  previewAssociatedLinksFromOnePassword: (id: number, dto: ImportHostAssociatedLinksFromOnePasswordDto) =>
    api.post<PreviewHostAssociatedLinksFromOnePasswordResponse>(`/hosts/${id}/preview-associated-links/onepassword`, dto),
  importAssociatedLinksFromOnePassword: (id: number, dto: ImportHostAssociatedLinksFromOnePasswordDto) =>
    api.post<HostPublic>(`/hosts/${id}/import-associated-links/onepassword`, dto).then(async (res) => {
      hostDetailCache.set(id, { data: res.data })
      hostByIdsCache.clear(undefined, 'host:import-associated-links')
      hostSidebarBootstrapCache.clear('host:import-associated-links')
      hostAssociatedLinksCatalogCache.clear('host:import-associated-links')
      await updateDefaultHostList(res.data, 'upsert')
      return res
    }),
  previewBulkAction: (dto: HostBulkPreviewDto) => api.post<HostBulkPreviewResponse>('/hosts/bulk/preview', dto),
  listBulkActionHistory: () => api.get<HostBulkActionHistoryResponse>('/hosts/bulk/history'),
  rollbackBulkAction: (historyId: number) => api.post<HostBulkApplyResponse>(`/hosts/bulk/history/${historyId}/rollback`).then((res) => {
    hostListCache.clear(undefined, 'host:bulk-rollback')
    hostDetailCache.clear(undefined, 'host:bulk-rollback')
    hostSidebarSummaryCache.clear('host:bulk-rollback')
    hostSidebarBootstrapCache.clear('host:bulk-rollback')
    hostAssociatedLinksCatalogCache.clear('host:bulk-rollback')
    hostByIdsCache.clear(undefined, 'host:bulk-rollback')
    return res
  }),
  applyBulkAction: (dto: HostBulkApplyDto) => api.post<HostBulkApplyResponse>('/hosts/bulk/apply', dto).then((res) => {
    hostListCache.clear(undefined, 'host:bulk-action')
    hostDetailCache.clear(undefined, 'host:bulk-action')
    hostSidebarSummaryCache.clear('host:bulk-action')
    hostSidebarBootstrapCache.clear('host:bulk-action')
    hostAssociatedLinksCatalogCache.clear('host:bulk-action')
    hostByIdsCache.clear(undefined, 'host:bulk-action')
    return res
  }),
  clearSidebarCaches: (reason = 'manual-sidebar-clear') => {
    hostSidebarSummaryCache.clear(reason)
    hostSidebarBootstrapCache.clear(reason)
    hostAssociatedLinksCatalogCache.clear(reason)
  },
  clear: (reason = 'manual-clear') => {
    hostListCache.clear(undefined, reason)
    hostDetailCache.clear(undefined, reason)
    hostSidebarSummaryCache.clear(reason)
    hostSidebarBootstrapCache.clear(reason)
    hostAssociatedLinksCatalogCache.clear(reason)
    hostByIdsCache.clear(undefined, reason)
  },
}
