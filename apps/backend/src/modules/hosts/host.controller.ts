import type { FastifyRequest, FastifyReply } from 'fastify'
import type { GroupPublic, TagPublic } from '@nodeaccess/shared'
import type { CreateHostDto, HostBulkApplyDto, HostBulkPreviewDto, TestConnectionDto, TrustHostKeyDto } from '@nodeaccess/shared'
import type { HostService } from './host.service.js'
import type { HostBulkActionService } from './host-bulk-action.service.js'
import type { TestConnectionService } from './test-connection.service.js'
import type { HostFilters } from './host.repository.js'
import type { FolderPublic, FolderService } from '../folders/folder.service.js'
import type { GroupService } from '../groups/group.service.js'
import type { TagService } from '../tags/tag.service.js'

interface IdParam   { id: string }
interface HostQuery {
  page?: number
  limit?: number
  search?: string
  scope?: string
  groupId?: number
  folderId?: number
  inventoryNodeId?: number
  tagId?: number
  unfiled?: boolean
  bastionId?: number
  pemKeyId?: number
  authType?: string
  accessProtocol?: string
  operatingSystem?: string
  connectionMode?: string
}
interface HostByIdsQuery { ids?: string }
interface HostSidebarBootstrap {
  summary: Awaited<ReturnType<HostService['getSidebarSummary']>>
  folders: FolderPublic[]
  groups: GroupPublic[]
  tags: TagPublic[]
}

export class HostController {
  constructor(
    private readonly hostService: HostService,
    private readonly testConnectionService: TestConnectionService,
    private readonly folderService: FolderService,
    private readonly groupService: GroupService,
    private readonly tagService: TagService,
    private readonly hostBulkActionService: HostBulkActionService,
  ) {}

  async list(request: FastifyRequest<{ Querystring: HostQuery }>, reply: FastifyReply) {
    const startedAt = Date.now()
    const { jwtUser } = request
    const filters = {
      ...(request.query.page !== undefined ? { page: request.query.page } : {}),
      ...(request.query.limit !== undefined ? { limit: request.query.limit } : {}),
      ...(request.query.search !== undefined ? { search: request.query.search } : {}),
      ...(request.query.scope !== undefined ? { scope: request.query.scope as HostFilters['scope'] } : {}),
      ...(request.query.groupId !== undefined ? { groupId: request.query.groupId } : {}),
      ...(request.query.folderId !== undefined ? { folderId: request.query.folderId } : {}),
      ...(request.query.inventoryNodeId !== undefined ? { inventoryNodeId: request.query.inventoryNodeId } : {}),
      ...(request.query.tagId !== undefined ? { tagId: request.query.tagId } : {}),
      ...(request.query.unfiled !== undefined ? { unfiled: request.query.unfiled } : {}),
      ...(request.query.bastionId !== undefined ? { bastionId: request.query.bastionId === 0 ? null : request.query.bastionId } : {}),
      ...(request.query.pemKeyId !== undefined ? { pemKeyId: request.query.pemKeyId === 0 ? null : request.query.pemKeyId } : {}),
      ...(request.query.authType !== undefined ? { authType: request.query.authType.toUpperCase() as HostFilters['authType'] } : {}),
      ...(request.query.accessProtocol !== undefined ? { accessProtocol: request.query.accessProtocol.toUpperCase() as HostFilters['accessProtocol'] } : {}),
      ...(request.query.operatingSystem !== undefined ? { operatingSystem: request.query.operatingSystem.toUpperCase() as HostFilters['operatingSystem'] } : {}),
      ...(request.query.connectionMode !== undefined ? { connectionMode: request.query.connectionMode.toUpperCase() as HostFilters['connectionMode'] } : {}),
    } as HostFilters
    const result = await this.hostService.list(
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      filters,
    )

    request.log.info({
      endpoint: 'hosts.list',
      page: result.page,
      limit: result.limit,
      total: result.total,
      rows: result.data.length,
      hasSearch: Boolean(filters.search),
      hasScope: Boolean(filters.scope),
      hasGroupId: Boolean(filters.groupId),
      hasFolderId: filters.folderId !== undefined,
      hasInventoryNodeId: filters.inventoryNodeId !== undefined,
      hasTagId: Boolean(filters.tagId),
      accessProtocol: filters.accessProtocol,
      unfiled: filters.unfiled === true,
      payloadBytes: Buffer.byteLength(JSON.stringify(result)),
      durationMs: Date.now() - startedAt,
    }, 'hosts list summary')

    return reply.send(result)
  }

  async getById(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    const host = await this.hostService.getById(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(host)
  }

  async listVisibleByIds(request: FastifyRequest<{ Querystring: HostByIdsQuery }>, reply: FastifyReply) {
    const startedAt = Date.now()
    const rawIds = (request.query.ids ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
    const uniqueIds = [...new Set(rawIds)]

    const { jwtUser } = request
    const hosts = await this.hostService.listVisibleByIds(
      uniqueIds,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    request.log.info({
      endpoint: 'hosts.by-ids',
      requestedIds: uniqueIds.length,
      returnedHosts: hosts.length,
      payloadBytes: Buffer.byteLength(JSON.stringify(hosts)),
      durationMs: Date.now() - startedAt,
    }, 'hosts by ids summary')
    return reply.send(hosts)
  }

  async listAssociatedLinksCatalog(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now()
    const { jwtUser } = request
    const links = await this.hostService.listAssociatedLinksCatalog(
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    request.log.info({
      endpoint: 'hosts.associated-links.catalog',
      rows: links.length,
      payloadBytes: Buffer.byteLength(JSON.stringify(links)),
      durationMs: Date.now() - startedAt,
    }, 'hosts associated links catalog summary')
    return reply.send(links)
  }

  async getSidebarSummary(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now()
    const { jwtUser } = request
    const summary = await this.hostService.getSidebarSummary(
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    request.log.info({
      endpoint: 'hosts.sidebar-summary',
      all: summary.all,
      folderKeys: Object.keys(summary.folders).length,
      groupKeys: Object.keys(summary.groups).length,
      tagKeys: Object.keys(summary.tags).length,
      payloadBytes: Buffer.byteLength(JSON.stringify(summary)),
      durationMs: Date.now() - startedAt,
    }, 'hosts sidebar summary')
    return reply.send(summary)
  }

  async getSidebarBootstrap(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now()
    const { jwtUser } = request
    const tenantId = jwtUser!.tenantId
    const userId = Number(jwtUser!.sub)
    const role = jwtUser!.role === 'admin' ? 'ADMIN' : 'USER'

    const [summary, folders, groups, tags] = await Promise.all([
      this.hostService.getSidebarSummary(tenantId, userId, role),
      this.folderService.list(userId, tenantId),
      this.groupService.list(tenantId, userId, role),
      this.tagService.list(tenantId),
    ])

    const payload: HostSidebarBootstrap = {
      summary,
      folders,
      groups,
      tags,
    }

    request.log.info({
      endpoint: 'hosts.sidebar-bootstrap',
      all: summary.all,
      folders: folders.length,
      groups: groups.length,
      tags: tags.length,
      payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
      durationMs: Date.now() - startedAt,
    }, 'hosts sidebar bootstrap')

    return reply.send(payload)
  }

  async create(request: FastifyRequest<{ Body: CreateHostDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const host = await this.hostService.create(
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.status(201).send(host)
  }

  async previewBulkAction(request: FastifyRequest<{ Body: HostBulkPreviewDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const preview = await this.hostBulkActionService.preview(
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(preview)
  }

  async applyBulkAction(request: FastifyRequest<{ Body: HostBulkApplyDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const result = await this.hostBulkActionService.apply(
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(result)
  }

  async listBulkActionHistory(request: FastifyRequest, reply: FastifyReply) {
    const { jwtUser } = request
    const result = await this.hostBulkActionService.listHistory(
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      jwtUser!.tenantId,
    )
    return reply.send(result)
  }

  async rollbackBulkAction(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    const result = await this.hostBulkActionService.rollback(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(result)
  }

  async update(request: FastifyRequest<{ Params: IdParam; Body: Partial<CreateHostDto> }>, reply: FastifyReply) {
    const { jwtUser } = request
    const host = await this.hostService.update(
      Number(request.params.id),
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(host)
  }

  async setPersonalFolder(request: FastifyRequest<{ Params: IdParam; Body: { folderId: number | null } }>, reply: FastifyReply) {
    const { jwtUser } = request
    const host = await this.hostService.setPersonalFolder(
      Number(request.params.id),
      request.body.folderId,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(host)
  }

  async delete(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    await this.hostService.delete(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.status(204).send()
  }

  async getDeleteCheck(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.hostService.getDeleteCheck(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(data)
  }

  async trustHostKey(request: FastifyRequest<{ Params: IdParam; Body: TrustHostKeyDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const host = await this.hostService.trustHostKey(
      Number(request.params.id),
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      !!jwtUser!.canManageHosts,
    )
    return reply.send(host)
  }

  async listHostKeyHistory(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    const history = await this.hostService.listHostKeyHistory(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(history)
  }

  async importAssociatedLinksFromOnePassword(
    request: FastifyRequest<{ Params: IdParam; Body: { ref: string } }>,
    reply: FastifyReply,
  ) {
    const { jwtUser } = request
    const host = await this.hostService.importAssociatedLinksFromOnePassword(
      Number(request.params.id),
      request.body.ref,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(host)
  }

  async previewAssociatedLinksFromOnePassword(
    request: FastifyRequest<{ Params: IdParam; Body: { ref: string } }>,
    reply: FastifyReply,
  ) {
    const { jwtUser } = request
    const links = await this.hostService.previewAssociatedLinksFromOnePassword(
      Number(request.params.id),
      request.body.ref,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send({ links })
  }

  async testConnection(request: FastifyRequest<{ Body: TestConnectionDto }>, reply: FastifyReply) {
    const result = await this.testConnectionService.test(
      request.body,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(result)
  }
}
