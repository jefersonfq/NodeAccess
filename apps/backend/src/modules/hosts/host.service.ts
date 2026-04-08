import type { HostPublic, CreateHostDto, HostKeyTrustEvent } from '@nodeaccess/shared'
import type { TrustHostKeyDto } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'
import { NotFoundError, ForbiddenError, ConflictError } from '../../shared/errors.js'
import { encrypt } from '../../shared/crypto.js'
import type { HostRepository, HostFilters, HostRow } from './host.repository.js'
import type { UserRepository } from '../users/user.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

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

function toPublic(host: HostRow): HostPublic {
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
    effectiveBastionId:     effectiveBastion?.id ?? null,
    effectiveBastionName:   effectiveBastion?.name ?? null,
    effectiveBastionSource,
    onePasswordRef: host.onePasswordRef,
    trustedHostKeyFingerprint: (host as HostRow & { trustedHostKeyFingerprint?: string | null }).trustedHostKeyFingerprint ?? null,
    trustedHostKeyVerifiedAt: (host as HostRow & { trustedHostKeyVerifiedAt?: Date | null }).trustedHostKeyVerifiedAt ?? null,
    tags:           host.tags.map((ht) => ({ id: ht.tag.id, name: ht.tag.name, color: ht.tag.color })),
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

export class HostService {
  constructor(
    private readonly hostRepo: HostRepository,
    private readonly userRepo: UserRepository,
    private readonly logRepo:  LogRepository,
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

    return { data: hosts.map(toPublic), total, page, limit }
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
    return toPublic(host)
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
    })

    await this.logRepo.logAdminEvent({ adminId: userId, action: 'CREATE_HOST', targetType: 'Host', targetId: host.id }).catch(() => { /* best-effort */ })
    return toPublic(host)
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
    })

    await this.logRepo.logAdminEvent({ adminId: userId, action: 'UPDATE_HOST', targetType: 'Host', targetId: id }).catch(() => { /* best-effort */ })
    return toPublic(updated)
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

    return toPublic(updated)
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

    if (nextAuthType === 'PASSWORD' && !hasPassword && !hasOnePasswordRef && mode === 'create') {
      throw new ConflictError('Senha SSH obrigatória para autenticação por senha')
    }

    if (nextAuthType === 'PEM_PASSWORD') {
      if (!hasPemKey) {
        throw new ConflictError('Chave PEM obrigatória para autenticação PEM + senha')
      }
      if (!hasPassword && !hasOnePasswordRef && mode === 'create') {
        throw new ConflictError('Senha SSH obrigatória para autenticação PEM + senha')
      }
    }
  }
}
