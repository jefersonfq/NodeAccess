import type { HostPublic, CreateHostDto, HostKeyTrustEvent, HostAssociatedLink } from '@nodeaccess/shared'
import type { TrustHostKeyDto } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../../shared/errors.js'
import { encrypt } from '../../shared/crypto.js'
import type { HostRepository, HostFilters, HostRow, HostDeleteCheck, HostSidebarSummary } from './host.repository.js'
import type { UserRepository } from '../users/user.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import type { WebhookService } from '../webhooks/webhook.service.js'

// Shared schema usa minúsculo; Prisma usa maiúsculo
type PrismaScope    = 'PERSONAL' | 'TEAM' | 'GLOBAL'
type PrismaAuthType = 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
type PrismaConnectionMode = 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO'

function mapScope(scope: string): PrismaScope {
  return scope.toUpperCase() as PrismaScope
}

function mapAuthType(authType: string): PrismaAuthType {
  return authType.toUpperCase() as PrismaAuthType
}

function mapConnectionMode(connectionMode: string): PrismaConnectionMode {
  return connectionMode.toUpperCase() as PrismaConnectionMode
}

function toPublic(host: HostRow, associatedLinks: HostAssociatedLink[] = []): HostPublic {
  const connectionMode = (host as HostRow & { connectionMode?: PrismaConnectionMode }).connectionMode ?? 'DIRECT'
  const hostBastion = host.bastion
  const groupBastion = host.group?.bastion ?? null
  const effectiveBastion = hostBastion ?? groupBastion
  const effectiveBastionSource: HostPublic['effectiveBastionSource'] =
    hostBastion ? 'host' : groupBastion ? 'group' : 'none'

  return {
    id:             host.id,
    tenantId:       host.tenantId,
    name:           host.name,
    ip:             host.ip,
    port:           host.port,
    sshUser:        host.sshUser,
    authType:       host.authType === 'PEM' ? 'pem' : host.authType === 'PEM_PASSWORD' ? 'pem_password' : 'password',
    connectionMode: connectionMode.toLowerCase() as HostPublic['connectionMode'],
    scope:          host.scope.toLowerCase() as HostPublic['scope'],
    groupId:        host.groupId,
    folderId:       host.folderId,
    bastionId:      host.bastionId,
    pemKeyId:       host.pemKeyId,
    hasPasswordCredential: Boolean(host.passwordEncrypted),
    effectiveBastionId:     effectiveBastion?.id ?? null,
    effectiveBastionName:   effectiveBastion?.name ?? null,
    effectiveBastionSource,
    onePasswordRef: host.onePasswordRef,
    trustedHostKeyFingerprint: (host as HostRow & { trustedHostKeyFingerprint?: string | null }).trustedHostKeyFingerprint ?? null,
    trustedHostKeyVerifiedAt: (host as HostRow & { trustedHostKeyVerifiedAt?: Date | null }).trustedHostKeyVerifiedAt ?? null,
    tags:           host.tags.map((ht) => ({ id: ht.tag.id, name: ht.tag.name, color: ht.tag.color })),
    associatedLinks,
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
    private readonly userRepo: UserRepository,
    private readonly logRepo:  LogRepository,
    private readonly onePasswordService: OnePasswordService,
    private readonly webhookService: WebhookService,
  ) {}

  async list(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    filters: HostFilters,
  ): Promise<Paginated<HostPublic>> {
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 20

    const userGroupIds = role === 'USER'
      ? await this.userRepo.findGroupIdsByUser(userId)
      : []

    const prismaScope = filters.scope ? mapScope(filters.scope) as HostFilters['scope'] : undefined
    const { hosts, total } = await this.hostRepo.findVisible(
      tenantId,
      userId,
      role,
      userGroupIds,
      { ...filters, ...(prismaScope ? { scope: prismaScope } : {}) },
    )

    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds(
      hosts.map((host) => host.id),
      tenantId,
    )

    return {
      data: hosts.map((host) => toPublic(host, linksByHostId.get(host.id) ?? [])),
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
    const userGroupIds = role === 'USER'
      ? await this.userRepo.findGroupIdsByUser(userId)
      : []

    const [summary, maxHosts] = await Promise.all([
      this.hostRepo.getSidebarSummary(tenantId, userId, role, userGroupIds),
      this.hostRepo.findHostLicenseLimit(tenantId),
    ])

    return {
      ...summary,
      maxHosts,
    }
  }

  async getById(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostPublic> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    this.assertCanAccess(host, userId, role, [])
    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds([host.id], tenantId)
    return toPublic(host, linksByHostId.get(host.id) ?? [])
  }

  async listVisibleByIds(
    ids: number[],
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostPublic[]> {
    if (ids.length === 0) return []

    const userGroupIds = role === 'USER'
      ? await this.userRepo.findGroupIdsByUser(userId)
      : []

    const hosts = await this.hostRepo.findVisibleByIds(tenantId, userId, role, userGroupIds, ids)
    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds(
      hosts.map((host) => host.id),
      tenantId,
    )
    const byId = new Map(hosts.map((host) => [host.id, toPublic(host, linksByHostId.get(host.id) ?? [])]))
    return ids.map((id) => byId.get(id)).filter((host): host is HostPublic => !!host)
  }

  async create(dto: CreateHostDto, tenantId: number, userId: number): Promise<HostPublic> {
    const maxHosts = await this.hostRepo.findHostLicenseLimit(tenantId)
    if (maxHosts !== null) {
      const registeredHosts = await this.hostRepo.countByTenant(tenantId)
      if (registeredHosts >= maxHosts) {
        throw new ForbiddenError('Limite de hosts da licença atingido')
      }
    }

    const scope    = mapScope(dto.scope)
    const authType = mapAuthType(dto.authType)
    this.assertValidHostAuth(dto, 'create')
    this.assertValidAssociatedLinks(dto)

    let passwordEncrypted: string | undefined
    if ((authType === 'PASSWORD' || authType === 'PEM_PASSWORD') && dto.password) {
      const { encrypted, iv } = encrypt(dto.password)
      passwordEncrypted = JSON.stringify({ encrypted, iv })
    }

    const host = await this.hostRepo.create({
      name:             dto.name,
      ip:               dto.ip,
      port:             dto.port,
      sshUser:          dto.sshUser,
      authType,
      connectionMode:   mapConnectionMode(dto.connectionMode),
      scope,
      tenantId,
      ...(scope === 'PERSONAL' && { ownerId: userId }),
      ...(dto.groupId        !== undefined && { groupId:        dto.groupId }),
      ...(dto.folderId       !== undefined && { folderId:       dto.folderId }),
      ...(dto.bastionId      !== undefined && { bastionId:      dto.bastionId }),
      ...(dto.pemKeyId       !== undefined && { pemKeyId:       dto.pemKeyId }),
      ...(dto.onePasswordRef !== undefined && { onePasswordRef: dto.onePasswordRef }),
      ...(passwordEncrypted  !== undefined && { passwordEncrypted }),
      ...(dto.tagNames       !== undefined && { tagNames:       dto.tagNames }),
      ...(dto.associatedLinks !== undefined && { associatedLinks: dto.associatedLinks }),
    })

    await this.logRepo.logAdminEvent({ adminId: userId, action: 'CREATE_HOST', targetType: 'Host', targetId: host.id }).catch(() => { /* best-effort */ })
    void this.webhookService.publishEvent({
      tenantId, eventType: 'host.created', eventVersion: 1,
      resourceType: 'host', resourceId: String(host.id),
      occurredAt: new Date(), data: { name: host.name, ip: host.ip },
    }).catch(() => {})
    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds([host.id], tenantId)
    return toPublic(host, linksByHostId.get(host.id) ?? [])
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

    this.assertCanEdit(host, userId, role)
    this.assertValidHostAuth(dto, 'update', {
      authType: host.authType,
      hasPemKey: !!(host as HostRow & { pemKeyId?: number | null }).pemKeyId,
      hasPassword: !!(host as HostRow & { passwordEncrypted?: string | null }).passwordEncrypted || !!host.onePasswordRef,
    })
    this.assertValidAssociatedLinks({
      ...dto,
      name: dto.name ?? host.name,
      ip: dto.ip ?? host.ip,
      port: dto.port ?? host.port,
      sshUser: dto.sshUser ?? host.sshUser,
    } as Partial<CreateHostDto> & Pick<CreateHostDto, 'name' | 'ip' | 'port' | 'sshUser'>)

    let passwordEncrypted: string | null | undefined
    const nextAuthType = dto.authType ? mapAuthType(dto.authType) : host.authType
    if ((dto.authType === 'password' || dto.authType === 'pem_password') && dto.password) {
      const { encrypted, iv } = encrypt(dto.password)
      passwordEncrypted = JSON.stringify({ encrypted, iv })
    } else if (nextAuthType === 'PEM') {
      passwordEncrypted = null
    }

    const updated = await this.hostRepo.update(id, tenantId, {
      ...(dto.name      !== undefined && { name:     dto.name }),
      ...(dto.ip        !== undefined && { ip:       dto.ip }),
      ...(dto.port      !== undefined && { port:     dto.port }),
      ...(dto.sshUser   !== undefined && { sshUser:  dto.sshUser }),
      ...(dto.authType  !== undefined && { authType: mapAuthType(dto.authType) }),
      ...(dto.connectionMode !== undefined && { connectionMode: mapConnectionMode(dto.connectionMode) }),
      ...(dto.scope     !== undefined && { scope:    mapScope(dto.scope) }),
      ...(dto.groupId   !== undefined && { groupId:   dto.groupId }),
      ...(dto.folderId  !== undefined && { folderId:  dto.folderId ?? null }),
      ...(dto.bastionId      !== undefined && { bastionId:      dto.bastionId }),
      ...(dto.pemKeyId       !== undefined && { pemKeyId:       dto.pemKeyId }),
      ...(dto.onePasswordRef !== undefined && { onePasswordRef: dto.onePasswordRef ?? null }),
      ...(passwordEncrypted !== undefined && { passwordEncrypted }),
      ...(dto.tagNames !== undefined && { tagNames: dto.tagNames }),
      ...(dto.associatedLinks !== undefined && { associatedLinks: dto.associatedLinks }),
    })

    await this.logRepo.logAdminEvent({ adminId: userId, action: 'UPDATE_HOST', targetType: 'Host', targetId: id }).catch(() => { /* best-effort */ })
    void this.webhookService.publishEvent({
      tenantId, eventType: 'host.updated', eventVersion: 1,
      resourceType: 'host', resourceId: String(id),
      occurredAt: new Date(), data: { name: updated.name },
    }).catch(() => {})
    const linksByHostId = await this.hostRepo.listAssociatedLinksByHostIds([updated.id], tenantId)
    return toPublic(updated, linksByHostId.get(updated.id) ?? [])
  }

  async delete(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<void> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    this.assertCanEdit(host, userId, role)

    if (await this.hostRepo.hasActiveSessions(id)) {
      throw new ConflictError('Não é possível excluir um host com sessões ativas')
    }

    await this.hostRepo.delete(id)
    await this.logRepo.logAdminEvent({ adminId: userId, action: 'DELETE_HOST', targetType: 'Host', targetId: id }).catch(() => { /* best-effort */ })
    void this.webhookService.publishEvent({
      tenantId, eventType: 'host.deleted', eventVersion: 1,
      resourceType: 'host', resourceId: String(id),
      occurredAt: new Date(), data: { name: host.name },
    }).catch(() => {})
  }

  async getDeleteCheck(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostDeleteCheck> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    this.assertCanEdit(host, userId, role)

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

    this.assertCanTrustHostKey(host, userId, role, canManageHosts)

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
    return toPublic(updated, linksByHostId.get(updated.id) ?? [])
  }

  async listHostKeyHistory(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostKeyTrustEvent[]> {
    const host = await this.hostRepo.findById(id, tenantId)
    if (!host) throw new NotFoundError('Host')

    this.assertCanEdit(host, userId, role)

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

    this.assertCanEdit(host, userId, role)

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
    return toPublic(updated, linksByHostId.get(updated.id) ?? [])
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

    this.assertCanEdit(host, userId, role)

    const raw = await this.onePasswordService.resolve(tenantId, ref)
    return this.parseAssociatedLinksFromOnePassword(raw, ref)
  }

  // ---------------------------------------------------------------------------
  // Guards de escopo
  // ---------------------------------------------------------------------------

  private assertCanAccess(
    host: HostRow,
    userId: number,
    role: 'ADMIN' | 'USER',
    userGroupIds: number[],
  ): void {
    if (role === 'ADMIN') return
    if (host.scope === 'GLOBAL') return
    if (host.scope === 'PERSONAL' && host.ownerId === userId) return
    if (host.scope === 'TEAM' && host.groupId && userGroupIds.includes(host.groupId)) return
    throw new ForbiddenError('Sem acesso a este host')
  }

  private assertCanEdit(host: HostRow, userId: number, role: 'ADMIN' | 'USER'): void {
    if (role === 'ADMIN') return
    if (host.scope === 'PERSONAL' && host.ownerId === userId) return
    if (host.scope === 'TEAM') return // qualquer membro do grupo pode editar hosts de equipe
    throw new ForbiddenError('Sem permissão para editar este host')
  }

  private assertCanTrustHostKey(
    host: HostRow,
    userId: number,
    role: 'ADMIN' | 'USER',
    canManageHosts: boolean,
  ): void {
    if (role === 'ADMIN') return
    if (host.scope === 'PERSONAL' && host.ownerId === userId) return
    if (host.scope === 'TEAM' && canManageHosts) return
    if (host.scope === 'TEAM') {
      throw new ForbiddenError('A atualização de host key em hosts de equipe exige permissão para gerenciar hosts')
    }
    if (host.scope === 'GLOBAL') {
      throw new ForbiddenError('A atualização de host key em hosts globais exige um administrador')
    }
    throw new ForbiddenError('Sem permissão para atualizar a host key deste host')
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
