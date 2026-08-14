import { canOpenInWebTerminal, usesSshCredentials, type HostAccessProtocol, type HostPublic, type CreateHostDto, type HostKeyTrustEvent, type HostAssociatedLink, type HostOperatingSystem } from '@nodeaccess/shared'
import type { TrustHostKeyDto } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'
import type { Redis } from 'ioredis'
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../../shared/errors.js'
import { encrypt } from '../../shared/crypto.js'
import type { HostRepository, HostFilters, HostRow, HostDeleteCheck, HostSidebarSummary } from './host.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import type { WebhookService } from '../webhooks/webhook.service.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { AppEventBus } from '../app-events/app-event.bus.js'

const SIDEBAR_SUMMARY_TTL = 30

export interface HostAssociatedLinkCatalogItem {
  host: Pick<HostPublic, 'id' | 'name' | 'ip' | 'port' | 'sshUser'>
  link: HostAssociatedLink
}

function sidebarSummaryCacheKey(tenantId: number, userId: number): string {
  return `hosts:sidebar:${tenantId}:${userId}`
}

// Shared schema usa minúsculo; Prisma usa maiúsculo
type PrismaScope    = 'PERSONAL' | 'TEAM' | 'GLOBAL'
type PrismaAuthType = 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
type PrismaConnectionMode = 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'PRIVATE_ACCESS_CONNECTOR' | 'AUTO'
type PrismaAccessProtocol = 'SSH' | 'RDP' | 'TELNET' | 'VNC' | 'SERIAL'
type PrismaOperatingSystem = 'UNKNOWN' | 'LINUX' | 'UBUNTU' | 'DEBIAN' | 'CENTOS' | 'RHEL' | 'ROCKY' | 'ALMALINUX' | 'SUSE' | 'WINDOWS' | 'WINDOWS_SERVER' | 'MACOS' | 'FREEBSD' | 'OTHER'
type PrismaStartupSnippetMode = 'DISABLED' | 'SUGGEST' | 'AUTO'

function mapScope(scope: string): PrismaScope {
  return scope.toUpperCase() as PrismaScope
}

function mapAuthType(authType: string): PrismaAuthType {
  return authType.toUpperCase() as PrismaAuthType
}

function mapConnectionMode(connectionMode: string): PrismaConnectionMode {
  return connectionMode.toUpperCase() as PrismaConnectionMode
}

function mapAccessProtocol(protocol: string | undefined): PrismaAccessProtocol {
  return (protocol ?? 'ssh').toUpperCase() as PrismaAccessProtocol
}

function mapStartupSnippetMode(mode: string | undefined | null): PrismaStartupSnippetMode {
  const normalized = String(mode ?? 'disabled').toUpperCase()
  return normalized === 'AUTO' || normalized === 'SUGGEST' ? normalized : 'DISABLED'
}

function mapOperatingSystem(operatingSystem: string | undefined): PrismaOperatingSystem {
  return (operatingSystem ?? 'unknown').toUpperCase() as PrismaOperatingSystem
}

function toSharedAccessProtocol(protocol: PrismaAccessProtocol): HostAccessProtocol {
  return protocol.toLowerCase() as HostAccessProtocol
}

function toSharedOperatingSystem(operatingSystem: PrismaOperatingSystem | undefined): HostOperatingSystem {
  return (operatingSystem ?? 'UNKNOWN').toLowerCase() as HostOperatingSystem
}

function usesPasswordCredential(protocol: PrismaAccessProtocol): boolean {
  const sharedProtocol = toSharedAccessProtocol(protocol)
  return usesSshCredentials(sharedProtocol) || sharedProtocol === 'rdp' || sharedProtocol === 'vnc'
}

function normalizeSshUserForProtocol(protocol: PrismaAccessProtocol, sshUser: string | undefined): string {
  if (!usesSshCredentials(toSharedAccessProtocol(protocol))) return ''
  const normalized = sshUser?.trim() ?? ''
  if (!normalized) throw new ValidationError('Usuário SSH é obrigatório para hosts SSH')
  return normalized
}

interface HostAccessPermissions {
  view: boolean
  connect: boolean
  edit: boolean
  admin: boolean
}

function toPublic(
  host: HostRow,
  associatedLinks: HostAssociatedLink[] = [],
  accessPermissions?: HostAccessPermissions,
): HostPublic {
  const connectionMode = (host as HostRow & { connectionMode?: PrismaConnectionMode }).connectionMode ?? 'DIRECT'
  const accessProtocol = (host as HostRow & { accessProtocol?: PrismaAccessProtocol }).accessProtocol ?? 'SSH'
  const operatingSystem = (host as HostRow & { operatingSystem?: PrismaOperatingSystem }).operatingSystem ?? 'UNKNOWN'
  const hostBastion = host.bastion
  const groupBastion = host.group?.bastion ?? null
  const effectiveBastion = hostBastion ?? groupBastion
  const effectiveBastionSource: HostPublic['effectiveBastionSource'] =
    hostBastion ? 'host' : groupBastion ? 'group' : 'none'

  return {
    id:             host.id,
    tenantId:       host.tenantId,
    name:           host.name,
    description:    host.description ?? null,
    ip:             host.ip,
    port:           host.port,
    accessProtocol: accessProtocol.toLowerCase() as HostPublic['accessProtocol'],
    operatingSystem: toSharedOperatingSystem(operatingSystem),
    sshUser:        host.sshUser,
    authType:       host.authType === 'PEM' ? 'pem' : host.authType === 'PEM_PASSWORD' ? 'pem_password' : 'password',
    connectionMode: connectionMode.toLowerCase() as HostPublic['connectionMode'],
    privateAccessConnectorId: host.privateAccessConnectorId ?? null,
    scope:          host.scope.toLowerCase() as HostPublic['scope'],
    groupId:        host.groupId,
    folderId:       host.folderId,
    inventoryNodeId: host.inventoryNode?.id ?? null,
    inventoryParentId: host.inventoryNode?.parentId ?? null,
    inventoryParentName: host.inventoryNode?.parent?.name ?? null,
    bastionId:      host.bastionId,
    pemKeyId:       host.pemKeyId,
    hasPasswordCredential: Boolean(host.passwordEncrypted),
    effectiveBastionId:     effectiveBastion?.id ?? null,
    effectiveBastionName:   effectiveBastion?.name ?? null,
    effectiveBastionSource,
    onePasswordRef: host.onePasswordRef,
    startupSnippetId: (host as HostRow & { startupSnippetId?: number | null }).startupSnippetId ?? null,
    startupSnippetMode: ((host as HostRow & { startupSnippetMode?: PrismaStartupSnippetMode }).startupSnippetMode ?? 'DISABLED').toLowerCase() as HostPublic['startupSnippetMode'],
    trustedHostKeyFingerprint: (host as HostRow & { trustedHostKeyFingerprint?: string | null }).trustedHostKeyFingerprint ?? null,
    trustedHostKeyVerifiedAt: (host as HostRow & { trustedHostKeyVerifiedAt?: Date | null }).trustedHostKeyVerifiedAt ?? null,
    tags:           host.tags.map((ht) => ({ id: ht.tag.id, name: ht.tag.name, color: ht.tag.color })),
    associatedLinks,
    ...(accessPermissions && { accessPermissions }),
    createdAt:      host.createdAt,
  }
}

function parseLogDetails(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

type HostAuditSnapshot = Record<string, string | number | boolean | null>

function hostAuditSnapshot(host: HostRow): HostAuditSnapshot {
  const accessProtocol = (host as HostRow & { accessProtocol?: PrismaAccessProtocol }).accessProtocol ?? 'SSH'
  const operatingSystem = (host as HostRow & { operatingSystem?: PrismaOperatingSystem }).operatingSystem ?? 'UNKNOWN'
  const connectionMode = (host as HostRow & { connectionMode?: PrismaConnectionMode }).connectionMode ?? 'DIRECT'
  return {
    name: host.name,
    description: host.description ?? null,
    ip: host.ip,
    port: host.port,
    accessProtocol,
    operatingSystem,
    sshUser: host.sshUser || null,
    authType: host.authType,
    connectionMode,
    privateAccessConnectorId: host.privateAccessConnectorId ?? null,
    scope: host.scope,
    groupId: host.groupId ?? null,
    folderId: host.folderId ?? null,
    bastionId: host.bastionId ?? null,
    pemKeyId: host.pemKeyId ?? null,
    onePasswordRef: host.onePasswordRef ?? null,
    startupSnippetId: (host as HostRow & { startupSnippetId?: number | null }).startupSnippetId ?? null,
    startupSnippetMode: (host as HostRow & { startupSnippetMode?: PrismaStartupSnippetMode }).startupSnippetMode ?? 'DISABLED',
    hasPasswordCredential: Boolean(host.passwordEncrypted),
  }
}

function normalizeHostDescription(value: string | null | undefined): string | null {
  const description = value?.trim() ?? ''
  return description || null
}

function hostAuditDiff(before: HostRow, after: HostRow) {
  const previous = hostAuditSnapshot(before)
  const next = hostAuditSnapshot(after)
  const changes = Object.entries(next)
    .filter(([key, value]) => previous[key] !== value)
    .map(([field, value]) => ({ field, before: previous[field] ?? null, after: value ?? null }))
  return { previous, next, changes }
}

function normalizeAssociatedLinkTemplate(template: string): string {
  return template
    .trim()
    .replaceAll('{{HOST:ID}}', '{{HOST.ID}}')
    .replaceAll('{{HOST:NAME}}', '{{HOST.NAME}}')
    .replaceAll('{{HOST:IP}}', '{{HOST.IP}}')
    .replaceAll('{{HOST:PORT}}', '{{HOST.PORT}}')
    .replaceAll('{{HOST:SSH_USER}}', '{{HOST.SSH_USER}}')
}

function findUnknownAssociatedLinkVariables(template: string): string[] {
  const matches = template.match(/\{\{[^}]+\}\}/g) ?? []
  const known = new Set([
    '{{HOST.ID}}',
    '{{HOST.NAME}}',
    '{{HOST.IP}}',
    '{{HOST.PORT}}',
    '{{HOST.SSH_USER}}',
  ])
  return [...new Set(matches.filter((token) => !known.has(token)))]
}

function resolveAssociatedLinkTemplate(
  template: string,
  context: { id: number; name: string; ip: string; port: number; sshUser: string },
): string {
  return normalizeAssociatedLinkTemplate(template)
    .replaceAll('{{HOST.ID}}', String(context.id))
    .replaceAll('{{HOST.NAME}}', context.name)
    .replaceAll('{{HOST.IP}}', context.ip)
    .replaceAll('{{HOST.PORT}}', String(context.port))
    .replaceAll('{{HOST.SSH_USER}}', context.sshUser)
}

function formatOnePasswordContentPreview(raw: string): string {
  const normalized = raw.replaceAll(/\s+/g, ' ').trim()
  if (!normalized) return '(vazio)'
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized
}

export class HostService {
  constructor(
    private readonly hostRepo: HostRepository,
    private readonly sshRepo: SshRepository,
    private readonly logRepo:  LogRepository,
    private readonly onePasswordService: OnePasswordService,
    private readonly webhookService: WebhookService,
    private readonly redis: Redis,
    private readonly appEventBus?: AppEventBus,
  ) {}

  async list(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    filters: HostFilters,
  ): Promise<Paginated<HostPublic>> {
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 20

    const prismaScope = filters.scope ? mapScope(filters.scope) as HostFilters['scope'] : undefined
    const { hosts, total } = await this.hostRepo.findVisible(
      tenantId,
      userId,
      role,
      { ...filters, ...(prismaScope ? { scope: prismaScope } : {}) },
    )

    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds(
      hosts.map((host) => host.id),
      tenantId,
    )
    const permissionsByHostId = await this.resolveHostPermissions(
      hosts.map((host) => host.id),
      tenantId,
      userId,
      role,
    )

    return {
      data: hosts.map((host) => toPublic(
        host,
        linksByHostId.get(host.id) ?? [],
        permissionsByHostId.get(host.id),
      )),
      total,
      page,
      limit,
    }
  }

  async getSidebarSummary(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostSidebarSummary> {
    const cacheKey = sidebarSummaryCacheKey(tenantId, userId)
    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached) as HostSidebarSummary

    const [summary, maxHosts] = await Promise.all([
      this.hostRepo.getSidebarSummary(tenantId, userId, role),
      this.hostRepo.findHostLicenseLimit(tenantId),
    ])

    const result: HostSidebarSummary = { ...summary, maxHosts }
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', SIDEBAR_SUMMARY_TTL)
    return result
  }

  async getById(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostPublic> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    const permissions = (await this.resolveHostPermissions([host.id], tenantId, userId, role)).get(host.id)
    if (!permissions?.view) throw new ForbiddenError('Sem acesso a este host')
    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds([host.id], tenantId)
    return toPublic(host, linksByHostId.get(host.id) ?? [], permissions)
  }

  async listVisibleByIds(
    ids: number[],
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostPublic[]> {
    if (ids.length === 0) return []

    const hosts = await this.hostRepo.findVisibleByIds(tenantId, userId, role, ids)
    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds(
      hosts.map((host) => host.id),
      tenantId,
    )
    const permissionsByHostId = await this.resolveHostPermissions(
      hosts.map((host) => host.id),
      tenantId,
      userId,
      role,
    )
    const byId = new Map(hosts.map((host) => [
      host.id,
      toPublic(host, linksByHostId.get(host.id) ?? [], permissionsByHostId.get(host.id)),
    ]))
    return ids.map((id) => byId.get(id)).filter((host): host is HostPublic => !!host)
  }

  async listAssociatedLinksCatalog(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostAssociatedLinkCatalogItem[]> {
    const rows = await this.hostRepo.listVisibleAssociatedLinksCatalog(tenantId, userId, role)
    return rows.map((row) => ({
      host: {
        id: row.hostId,
        name: row.hostName,
        ip: row.hostIp,
        port: row.hostPort,
        sshUser: row.hostSshUser,
      },
      link: {
        id: row.id,
        label: row.label,
        urlTemplate: row.urlTemplate,
        position: row.position,
        enabled: Boolean(row.enabled),
        openMode: row.openMode,
        sourceType: row.sourceType,
        sourceProvider: row.sourceProvider,
        sourceRef: row.sourceRef,
        sourceStatus: row.sourceStatus,
        sourceUpdatedAt: row.sourceUpdatedAt,
      },
    }))
  }

  async create(
    dto: CreateHostDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER' = 'USER',
  ): Promise<HostPublic> {
    const maxHosts = await this.hostRepo.findHostLicenseLimit(tenantId)
    if (maxHosts !== null) {
      const registeredHosts = await this.hostRepo.countByTenant(tenantId)
      if (registeredHosts >= maxHosts) {
        throw new ForbiddenError('Limite de hosts da licença atingido')
      }
    }

    const scope          = mapScope(dto.scope)
    const authType       = mapAuthType(dto.authType)
    const accessProtocol = mapAccessProtocol(dto.accessProtocol)
    const operatingSystem = mapOperatingSystem(dto.operatingSystem)
    const isSshProtocol  = usesSshCredentials(toSharedAccessProtocol(accessProtocol))
    const canStorePassword = usesPasswordCredential(accessProtocol)
    const supportsStartupSnippet = canOpenInWebTerminal(toSharedAccessProtocol(accessProtocol))
    const startupSnippetMode = supportsStartupSnippet ? mapStartupSnippetMode(dto.startupSnippetMode) : 'DISABLED'
    const sshUser = normalizeSshUserForProtocol(accessProtocol, dto.sshUser)
    if (isSshProtocol) this.assertValidHostAuth(dto, 'create')
    this.assertValidAssociatedLinks(dto)
    if (isSshProtocol) {
      await this.assertTenantBastion(dto.bastionId, tenantId)
      await this.assertTenantPemKey(dto.pemKeyId, tenantId)
    }
    await this.assertInventoryDestination(dto.inventoryParentId, tenantId, userId, role, { required: true })
    await this.assertPersonalFolder(dto.folderId, userId, tenantId)
    await this.assertPrivateAccessConnector(dto.connectionMode, dto.privateAccessConnectorId, tenantId)

    let passwordEncrypted: string | undefined
    if (canStorePassword && (authType === 'PASSWORD' || authType === 'PEM_PASSWORD') && dto.password) {
      const { encrypted, iv } = encrypt(dto.password)
      passwordEncrypted = JSON.stringify({ encrypted, iv })
    }

    const host = await this.hostRepo.create({
      name:             dto.name,
      description:      normalizeHostDescription(dto.description),
      ip:               dto.ip,
      port:             dto.port,
      accessProtocol,
      operatingSystem,
      sshUser,
      authType:         isSshProtocol ? authType : 'PASSWORD',
      connectionMode:   mapConnectionMode(dto.connectionMode),
      privateAccessConnectorId: dto.connectionMode === 'private_access_connector' ? dto.privateAccessConnectorId ?? null : null,
      scope,
      tenantId,
      ...(scope === 'PERSONAL' && { ownerId: userId }),
      ...(dto.groupId        !== undefined && { groupId:        dto.groupId }),
      inventoryParentId: dto.inventoryParentId,
      ...(isSshProtocol && dto.bastionId      !== undefined && { bastionId:      dto.bastionId }),
      ...(isSshProtocol && dto.pemKeyId       !== undefined && { pemKeyId:       dto.pemKeyId }),
      ...(isSshProtocol && dto.onePasswordRef !== undefined && { onePasswordRef: dto.onePasswordRef }),
      startupSnippetId: startupSnippetMode === 'DISABLED' ? null : dto.startupSnippetId ?? null,
      startupSnippetMode,
      ...(passwordEncrypted  !== undefined && { passwordEncrypted }),
      ...(dto.tagNames       !== undefined && { tagNames:       dto.tagNames }),
      ...(dto.associatedLinks !== undefined && { associatedLinks: dto.associatedLinks }),
    })
    if (dto.folderId !== undefined) {
      await this.hostRepo.setPersonalFolder(host.id, dto.folderId ?? null, userId, tenantId)
    }

    void this.redis.del(sidebarSummaryCacheKey(tenantId, userId)).catch(() => {})
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'CREATE_HOST',
      targetType: 'Host',
      targetId: host.id,
      details: JSON.stringify({ next: hostAuditSnapshot(host) }),
    }).catch(() => { /* best-effort */ })
    void this.webhookService.publishEvent({
      tenantId, eventType: 'host.created', eventVersion: 1,
      resourceType: 'host', resourceId: String(host.id),
      occurredAt: new Date(), data: { name: host.name, ip: host.ip },
    }).catch(() => {})
    await this.publishInventoryAclChanged(dto.inventoryParentId, host.id, tenantId, userId, 'move')
    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds([host.id], tenantId)
    const permissions = (await this.resolveHostPermissions([host.id], tenantId, userId, role)).get(host.id)
    const hostForCurrentUser = dto.folderId !== undefined
      ? { ...host, folderId: dto.folderId ?? null } as HostRow
      : await this.hostRepo.findByIdForUser(host.id, tenantId, userId) ?? host
    return toPublic(hostForCurrentUser, linksByHostId.get(host.id) ?? [], permissions)
  }

  async update(
    id: number,
    dto: Partial<CreateHostDto>,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostPublic> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanEdit(host, userId, role, tenantId)
    const currentProtocol = (host as HostRow & { accessProtocol?: PrismaAccessProtocol }).accessProtocol ?? 'SSH'
    const nextProtocol = dto.accessProtocol !== undefined ? mapAccessProtocol(dto.accessProtocol) : currentProtocol
    const bastionProfileId = await this.hostRepo.findBastionProfileIdBySourceHost(id, tenantId)
    if (bastionProfileId !== null) {
      const nextConnectionMode = dto.connectionMode !== undefined ? mapConnectionMode(dto.connectionMode) : host.connectionMode
      const nextOnePasswordRef = dto.onePasswordRef !== undefined ? dto.onePasswordRef : host.onePasswordRef
      const nextGroupId = dto.groupId !== undefined ? dto.groupId : host.groupId
      if (nextProtocol !== 'SSH') throw new ValidationError('Um host bastion deve permanecer com protocolo SSH')
      if (nextConnectionMode !== 'DIRECT') throw new ValidationError('Um host bastion deve permanecer com conexão direta')
      if (nextOnePasswordRef) throw new ValidationError('Um host bastion não pode usar credencial 1Password')
      if (await this.hostRepo.findGroupBastionId(nextGroupId, tenantId) !== null) {
        throw new ValidationError('Um host que atua como bastion não pode pertencer a um grupo que herda outro bastion')
      }
    }
    const isSshProtocol = usesSshCredentials(toSharedAccessProtocol(nextProtocol))
    const canStorePassword = usesPasswordCredential(nextProtocol)
    const shouldValidateSshUser = isSshProtocol && (dto.accessProtocol !== undefined || dto.sshUser !== undefined)
    const sshUser = shouldValidateSshUser
      ? normalizeSshUserForProtocol(nextProtocol, dto.sshUser ?? host.sshUser)
      : (host.sshUser ?? '').trim()
    if (isSshProtocol) {
      this.assertValidHostAuth(dto, 'update', {
        authType: host.authType,
        hasPemKey: !!(host as HostRow & { pemKeyId?: number | null }).pemKeyId,
        hasPassword: !!(host as HostRow & { passwordEncrypted?: string | null }).passwordEncrypted || !!host.onePasswordRef,
      })
    }
    this.assertValidAssociatedLinks({
      ...dto,
      name: dto.name ?? host.name,
      ip: dto.ip ?? host.ip,
      port: dto.port ?? host.port,
      sshUser: dto.sshUser ?? host.sshUser,
    } as Partial<CreateHostDto> & Pick<CreateHostDto, 'name' | 'ip' | 'port' | 'sshUser'>)
    if (isSshProtocol) {
      await this.assertTenantBastion(dto.bastionId, tenantId, id)
      await this.assertTenantPemKey(dto.pemKeyId, tenantId)
    }
    await this.assertPrivateAccessConnector(dto.connectionMode, dto.privateAccessConnectorId, tenantId)
    await this.assertInventoryDestination(dto.inventoryParentId, tenantId, userId, role)
    await this.assertPersonalFolder(dto.folderId, userId, tenantId)

    let passwordEncrypted: string | null | undefined
    const nextAuthType = dto.authType ? mapAuthType(dto.authType) : host.authType
    if (!canStorePassword) {
      passwordEncrypted = null
    } else if ((dto.authType === 'password' || dto.authType === 'pem_password' || !isSshProtocol) && dto.password) {
      const { encrypted, iv } = encrypt(dto.password)
      passwordEncrypted = JSON.stringify({ encrypted, iv })
    } else if (isSshProtocol && nextAuthType === 'PEM') {
      passwordEncrypted = null
    }

    const currentStartupSnippetMode =
      (host as HostRow & { startupSnippetMode?: PrismaStartupSnippetMode }).startupSnippetMode ?? 'DISABLED'
    const currentStartupSnippetId =
      (host as HostRow & { startupSnippetId?: number | null }).startupSnippetId ?? null
    const supportsStartupSnippet = canOpenInWebTerminal(toSharedAccessProtocol(nextProtocol))
    const nextStartupSnippetMode = !supportsStartupSnippet
      ? 'DISABLED'
      : dto.startupSnippetMode !== undefined
      ? mapStartupSnippetMode(dto.startupSnippetMode)
      : currentStartupSnippetMode
    const nextStartupSnippetId = nextStartupSnippetMode === 'DISABLED'
      ? null
      : dto.startupSnippetId !== undefined ? dto.startupSnippetId : currentStartupSnippetId

    const updated = await this.hostRepo.update(id, tenantId, {
      ...(dto.name      !== undefined && { name:     dto.name }),
      ...(dto.description !== undefined && { description: normalizeHostDescription(dto.description) }),
      ...(dto.ip        !== undefined && { ip:       dto.ip }),
      ...(dto.port      !== undefined && { port:     dto.port }),
      ...(dto.accessProtocol !== undefined && { accessProtocol: nextProtocol }),
      ...(dto.operatingSystem !== undefined && { operatingSystem: mapOperatingSystem(dto.operatingSystem) }),
      ...(isSshProtocol
        ? {
            ...(dto.sshUser   !== undefined && { sshUser }),
            ...(dto.authType  !== undefined && { authType: mapAuthType(dto.authType) }),
          }
        : { sshUser: '', authType: 'PASSWORD' as const }),
      ...(dto.connectionMode !== undefined && { connectionMode: mapConnectionMode(dto.connectionMode) }),
      ...((dto.connectionMode !== undefined || dto.privateAccessConnectorId !== undefined) && {
        privateAccessConnectorId: dto.connectionMode === 'private_access_connector' ? dto.privateAccessConnectorId ?? null : null,
      }),
      ...(dto.scope     !== undefined && {
        scope: mapScope(dto.scope),
        ownerId: mapScope(dto.scope) === 'PERSONAL' ? userId : null,
      }),
      ...(dto.groupId   !== undefined && { groupId:   dto.groupId }),
      ...(dto.inventoryParentId !== undefined && { inventoryParentId: dto.inventoryParentId }),
      ...(isSshProtocol
        ? {
            ...(dto.bastionId      !== undefined && { bastionId:      dto.bastionId }),
            ...(dto.pemKeyId       !== undefined && { pemKeyId:       dto.pemKeyId }),
            ...(dto.onePasswordRef !== undefined && { onePasswordRef: dto.onePasswordRef ?? null }),
          }
        : { bastionId: null, pemKeyId: null, onePasswordRef: null }),
      ...((dto.startupSnippetId !== undefined || dto.startupSnippetMode !== undefined || dto.accessProtocol !== undefined) && {
        startupSnippetId: nextStartupSnippetId,
        startupSnippetMode: nextStartupSnippetMode,
      }),
      ...(passwordEncrypted !== undefined && { passwordEncrypted }),
      ...(dto.tagNames !== undefined && { tagNames: dto.tagNames }),
      ...(dto.associatedLinks !== undefined && { associatedLinks: dto.associatedLinks }),
    })
    if (dto.folderId !== undefined) {
      await this.hostRepo.setPersonalFolder(id, dto.folderId ?? null, userId, tenantId)
    }

    void this.redis.del(sidebarSummaryCacheKey(tenantId, userId)).catch(() => {})
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'UPDATE_HOST',
      targetType: 'Host',
      targetId: id,
      details: JSON.stringify(hostAuditDiff(host, updated)),
    }).catch(() => { /* best-effort */ })
    void this.webhookService.publishEvent({
      tenantId, eventType: 'host.updated', eventVersion: 1,
      resourceType: 'host', resourceId: String(id),
      occurredAt: new Date(), data: { name: updated.name },
    }).catch(() => {})
    const previousInventoryParentId = host.inventoryNode?.parentId ?? null
    if (dto.inventoryParentId !== undefined && dto.inventoryParentId !== previousInventoryParentId) {
      if (dto.inventoryParentId === null) {
        if (previousInventoryParentId !== null) {
          await this.publishInventoryAclChanged(previousInventoryParentId, updated.id, tenantId, userId, 'move')
        }
        await this.auditInventoryHostUnlinked(userId, updated.id, previousInventoryParentId)
      } else {
        await this.publishInventoryAclChanged(dto.inventoryParentId, updated.id, tenantId, userId, 'move')
        await this.auditInventoryHostMoved(userId, dto.inventoryParentId, updated.id, previousInventoryParentId)
      }
    }
    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds([updated.id], tenantId)
    const permissions = (await this.resolveHostPermissions([updated.id], tenantId, userId, role)).get(updated.id)
    const updatedForCurrentUser = dto.folderId !== undefined
      ? { ...updated, folderId: dto.folderId ?? null } as HostRow
      : await this.hostRepo.findByIdForUser(updated.id, tenantId, userId) ?? updated
    return toPublic(updatedForCurrentUser, linksByHostId.get(updated.id) ?? [], permissions)
  }

  async delete(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<void> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanEdit(host, userId, role, tenantId)

    if (await this.hostRepo.hasActiveSessions(id)) {
      throw new ConflictError('Não é possível excluir um host com sessões ativas')
    }
    if (await this.hostRepo.findBastionProfileIdBySourceHost(id, tenantId)) {
      throw new ConflictError('Este host atua como bastion. Desabilite o perfil de bastion antes de excluí-lo')
    }

    await this.hostRepo.delete(id)
    void this.redis.del(sidebarSummaryCacheKey(tenantId, userId)).catch(() => {})
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'DELETE_HOST',
      targetType: 'Host',
      targetId: id,
      details: JSON.stringify({ previous: hostAuditSnapshot(host) }),
    }).catch(() => { /* best-effort */ })
    void this.webhookService.publishEvent({
      tenantId, eventType: 'host.deleted', eventVersion: 1,
      resourceType: 'host', resourceId: String(id),
      occurredAt: new Date(), data: { name: host.name },
    }).catch(() => {})
  }

  private async assertPrivateAccessConnector(connectionMode: string | undefined, connectorId: number | null | undefined, tenantId: number): Promise<void> {
    if (connectionMode !== 'private_access_connector' || connectorId == null) return
    if (!await this.hostRepo.privateAccessConnectorExists(connectorId, tenantId)) {
      throw new ValidationError('Conector de acesso privado inválido para este tenant')
    }
  }

  private async publishInventoryAclChanged(
    inventoryNodeId: number,
    hostId: number,
    tenantId: number,
    actorId: number,
    action: 'move',
  ): Promise<void> {
    await this.appEventBus?.publish({
      type: 'inventory_acl_changed',
      tenantId,
      inventoryNodeId,
      hostId,
      actorId,
      principalType: 'ROLE',
      principalId: 1,
      action,
      changedAt: new Date().toISOString(),
    }).catch(() => { /* best-effort realtime/revocation */ })
  }

  private async auditInventoryHostMoved(
    actorId: number,
    inventoryNodeId: number,
    hostId: number,
    previousInventoryNodeId: number | null,
  ): Promise<void> {
    await this.logRepo.logAdminEvent({
      adminId: actorId,
      action: 'INVENTORY_ACL_HOSTS_MOVED',
      targetType: 'InventoryNode',
      targetId: inventoryNodeId,
      details: JSON.stringify({
        selection: { mode: 'ids', hostIds: [hostId] },
        requested: 1,
        updated: 1,
        skipped: 0,
        hostIds: [hostId],
        hostIdsTruncated: false,
        previousInventoryNodeId,
      }),
    }).catch(() => { /* best-effort */ })
  }

  private async auditInventoryHostUnlinked(
    actorId: number,
    hostId: number,
    previousInventoryNodeId: number | null,
  ): Promise<void> {
    await this.logRepo.logAdminEvent({
      adminId: actorId,
      action: 'INVENTORY_ACL_HOST_UNLINKED',
      targetType: 'Host',
      targetId: hostId,
      details: JSON.stringify({
        hostIds: [hostId],
        previousInventoryNodeId,
      }),
    }).catch(() => { /* best-effort */ })
  }

  private async assertInventoryDestination(
    inventoryParentId: number | null | undefined,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    options: { required?: boolean } = {},
  ): Promise<void> {
    if (inventoryParentId === undefined || inventoryParentId === null) {
      if (options.required) throw new ValidationError('Selecione uma pasta do inventário corporativo para definir a ACL do host')
      return
    }
    const folder = await this.hostRepo.inventoryFolderAclSummary(inventoryParentId, tenantId)
    if (!folder) throw new ValidationError('Pasta do inventário não encontrada neste tenant')
    if (folder.aclEntries === 0) {
      throw new ValidationError('A pasta de destino não possui ACL aplicável; configure permissões antes de importar hosts')
    }
    if (role === 'ADMIN') return
    const permissions = await this.hostRepo.inventoryFolderEffectivePermissions(inventoryParentId, tenantId, userId)
    if (!permissions.edit && !permissions.admin) {
      throw new ForbiddenError('Mover ou criar hosts nesta pasta exige permissão Editar ou Administrar ACL')
    }
  }

  private async assertPersonalFolder(folderId: number | null | undefined, userId: number, tenantId: number): Promise<void> {
    if (folderId === undefined || folderId === null) return
    if (!await this.hostRepo.personalFolderExists(folderId, userId, tenantId)) {
      throw new ValidationError('Pasta pessoal não encontrada para o usuário atual')
    }
  }

  async getDeleteCheck(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostDeleteCheck> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanEdit(host, userId, role, tenantId)

    const activeSessions = await this.hostRepo.countActiveSessions(id)
    const blockers = {
      sessions: activeSessions,
      sessionAudits: 0,
      mcpInteractiveSessions: 0,
    }

    return {
      canDelete: activeSessions === 0,
      blockers,
    }
  }

  async trustHostKey(
    id: number,
    dto: TrustHostKeyDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    canManageHosts: boolean,
  ): Promise<HostPublic> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanEdit(host, userId, role, tenantId)

    const hadTrustedFingerprint = !!(host as HostRow & { trustedHostKeyFingerprint?: string | null }).trustedHostKeyFingerprint
    const previousFingerprint = (host as HostRow & { trustedHostKeyFingerprint?: string | null }).trustedHostKeyFingerprint ?? null
    const updated = await this.hostRepo.trustHostKey(id, tenantId, dto.fingerprint, userId)

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: hadTrustedFingerprint ? 'HOST_KEY_UPDATED' : 'HOST_KEY_TRUSTED',
      targetType: 'Host',
      targetId: id,
      details: JSON.stringify({
        previousFingerprint,
        nextFingerprint: dto.fingerprint,
      }),
    }).catch(() => { /* best-effort */ })

    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds([updated.id], tenantId)
    const permissions = (await this.resolveHostPermissions([updated.id], tenantId, userId, role)).get(updated.id)
    return toPublic(updated, linksByHostId.get(updated.id) ?? [], permissions)
  }

  async listHostKeyHistory(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostKeyTrustEvent[]> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanEdit(host, userId, role, tenantId)

    const logs = await this.logRepo.findRecentAdminEventsByTarget(
      tenantId,
      'Host',
      id,
      ['HOST_KEY_TRUSTED', 'HOST_KEY_UPDATED'],
      10,
    )

    return logs.map((row) => {
      const details = parseLogDetails(row.details)
      return {
        action: row.action as HostKeyTrustEvent['action'],
        adminName: row.admin.name,
        previousFingerprint: typeof details.previousFingerprint === 'string' ? details.previousFingerprint : null,
        nextFingerprint: typeof details.nextFingerprint === 'string' ? details.nextFingerprint : null,
        timestamp: row.timestamp,
      }
    })
  }

  async importAssociatedLinksFromOnePassword(
    id: number,
    ref: string,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostPublic> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanEdit(host, userId, role, tenantId)

    const raw = await this.onePasswordService.resolve(tenantId, ref)
    const importedLinks = this.parseAssociatedLinksFromOnePassword(raw, ref)
    const existingLinks = (await this.hostRepo.listAssociatedLinksByHostIds([id], tenantId)).get(id) ?? []
    const preservedLinks = existingLinks.filter((link) =>
      !(link.sourceType === 'integration' && link.sourceProvider === 'onepassword'),
    )
    const mergedLinks = [...preservedLinks, ...importedLinks].map((link, position) => ({ ...link, position }))

    const updated = await this.hostRepo.update(id, tenantId, { associatedLinks: mergedLinks })
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'IMPORT_HOST_ASSOCIATED_LINKS_ONEPASSWORD',
      targetType: 'Host',
      targetId: id,
      details: JSON.stringify({ ref, imported: importedLinks.length }),
    }).catch(() => { /* best-effort */ })

    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds([updated.id], tenantId)
    const permissions = (await this.resolveHostPermissions([updated.id], tenantId, userId, role)).get(updated.id)
    return toPublic(updated, linksByHostId.get(updated.id) ?? [], permissions)
  }

  async previewAssociatedLinksFromOnePassword(
    id: number,
    ref: string,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostAssociatedLink[]> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanEdit(host, userId, role, tenantId)

    const raw = await this.onePasswordService.resolve(tenantId, ref)
    return this.parseAssociatedLinksFromOnePassword(raw, ref)
  }

  // ---------------------------------------------------------------------------
  // Guards de escopo
  // ---------------------------------------------------------------------------

  private async assertCanEdit(
    host: HostRow,
    userId: number,
    role: 'ADMIN' | 'USER',
    tenantId: number,
  ): Promise<void> {
    if (role === 'ADMIN') return
    const permissions = (await this.resolveHostPermissions([host.id], tenantId, userId, role)).get(host.id)
    if (permissions?.edit) return
    throw new ForbiddenError('Sem permissão para editar este host')
  }

  private async resolveHostPermissions(
    hostIds: number[],
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<Map<number, HostAccessPermissions>> {
    if (role === 'ADMIN') {
      return new Map(hostIds.map((hostId) => [
        hostId,
        { view: true, connect: true, edit: true, admin: true },
      ]))
    }
    return this.sshRepo.getEffectiveHostPermissionSets(hostIds, tenantId, userId, role)
  }

  private assertValidAssociatedLinks(
    dto: Partial<CreateHostDto> & Pick<CreateHostDto, 'name' | 'ip' | 'port' | 'sshUser'>,
  ): void {
    for (const link of dto.associatedLinks ?? []) {
      const normalized = normalizeAssociatedLinkTemplate(link.urlTemplate)
      const unknownVariables = findUnknownAssociatedLinkVariables(normalized)
      if (unknownVariables.length > 0) {
        throw new ValidationError(`Placeholder inválido em link associado "${link.label}": ${unknownVariables.join(', ')}`)
      }
      const schemeMatch = normalized.match(/^([a-z][a-z0-9+.-]*):\/\//i)
      const scheme = schemeMatch?.[1]?.toLowerCase() ?? null
      if (scheme !== 'http' && scheme !== 'https') {
        throw new ValidationError(`O link associado "${link.label}" deve usar apenas http:// ou https://`)
      }
      try {
        new URL(resolveAssociatedLinkTemplate(normalized, {
          id: 0,
          name: dto.name,
          ip: dto.ip,
          port: dto.port,
          sshUser: dto.sshUser,
        }))
      } catch {
        throw new ValidationError(`O link associado "${link.label}" gera uma URL inválida com os dados atuais do host`)
      }
    }
  }

  private async assertTenantBastion(bastionId: number | undefined, tenantId: number, targetHostId?: number): Promise<void> {
    if (bastionId === undefined) return
    if (!await this.hostRepo.bastionExists(bastionId, tenantId)) {
      throw new ValidationError('Bastion não encontrado neste tenant')
    }
    if (targetHostId === undefined) return
    const [sourceHostId, ownProfileId] = await Promise.all([
      this.hostRepo.findBastionSourceHostId(bastionId, tenantId),
      this.hostRepo.findBastionProfileIdBySourceHost(targetHostId, tenantId),
    ])
    if (sourceHostId === targetHostId) throw new ValidationError('Um host não pode usar a si mesmo como bastion')
    if (ownProfileId !== null) throw new ValidationError('Um host que atua como bastion não pode depender de outro bastion')
  }

  private async assertTenantPemKey(pemKeyId: number | undefined, tenantId: number): Promise<void> {
    if (pemKeyId === undefined) return
    if (await this.hostRepo.pemKeyExists(pemKeyId, tenantId)) return
    throw new ValidationError('Chave PEM não encontrada neste tenant')
  }

  private parseAssociatedLinksFromOnePassword(raw: string, ref: string): HostAssociatedLink[] {
    const preview = formatOnePasswordContentPreview(raw)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new ValidationError(`O conteúdo resolvido do 1Password para links associados deve ser um JSON válido. Trecho recebido: ${preview}`)
    }

    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { links?: unknown[] }).links)
        ? (parsed as { links: unknown[] }).links
        : null

    if (!items) {
      throw new ValidationError(`O JSON do 1Password deve ser um array de links ou um objeto com a chave "links". Trecho recebido: ${preview}`)
    }

    const now = new Date()
    const imported = items.map((item, index) => {
      if (typeof item === 'string') {
        return {
          label: `Link ${index + 1}`,
          urlTemplate: item,
          position: index,
          enabled: true,
          openMode: 'new_tab' as const,
          sourceType: 'integration' as const,
          sourceProvider: 'onepassword',
          sourceRef: ref,
          sourceStatus: 'synced' as const,
          sourceUpdatedAt: now,
        }
      }

      if (!item || typeof item !== 'object') {
        throw new ValidationError(`Cada link importado do 1Password deve ser string ou objeto. Trecho recebido: ${preview}`)
      }

      const record = item as Record<string, unknown>
      const label = typeof record.label === 'string'
        ? record.label
        : typeof record.title === 'string'
          ? record.title
          : typeof record.name === 'string'
            ? record.name
            : `Link ${index + 1}`
      const urlTemplate = typeof record.urlTemplate === 'string'
        ? record.urlTemplate
        : typeof record.url === 'string'
          ? record.url
          : typeof record.url_template === 'string'
            ? record.url_template
            : null

      if (!urlTemplate) {
        throw new ValidationError(`O link importado "${label}" não possui url/urlTemplate válido. Trecho recebido: ${preview}`)
      }

      const openMode: 'new_tab' | 'same_tab' =
        record.openMode === 'same_tab' || record.open_mode === 'same_tab'
          ? 'same_tab'
          : 'new_tab'

      return {
        label,
        urlTemplate,
        position: index,
        enabled: record.enabled !== false,
        openMode,
        sourceType: 'integration' as const,
        sourceProvider: 'onepassword',
        sourceRef: ref,
        sourceStatus: 'synced' as const,
        sourceUpdatedAt: now,
      }
    })

    this.assertValidAssociatedLinks({
      name: 'import',
      ip: '127.0.0.1',
      port: 22,
      sshUser: 'root',
      associatedLinks: imported,
    })

    return imported
  }

  private assertValidHostAuth(
    dto: Partial<CreateHostDto>,
    mode: 'create' | 'update',
    current?: { authType: PrismaAuthType; hasPemKey: boolean; hasPassword: boolean },
  ): void {
    const nextAuthType = dto.authType ? mapAuthType(dto.authType) : current?.authType
    if (!nextAuthType) return

    const hasPemKey = dto.pemKeyId !== undefined
      ? dto.pemKeyId !== undefined && dto.pemKeyId !== null
      : current?.hasPemKey ?? false
    const hasPassword = dto.password !== undefined
      ? dto.password.trim().length > 0
      : current?.hasPassword ?? false
    const hasOnePasswordRef = dto.onePasswordRef !== undefined
      ? !!dto.onePasswordRef
      : false

    if (nextAuthType === 'PEM' && !hasPemKey && mode === 'create') {
      throw new ConflictError('Chave PEM obrigatória para autenticação por chave')
    }

    if (nextAuthType === 'PEM_PASSWORD' && !hasPemKey) {
      throw new ConflictError('Chave PEM obrigatória para autenticação PEM + senha')
    }
  }
}
