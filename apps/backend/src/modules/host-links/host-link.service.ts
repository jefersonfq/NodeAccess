import { createHash, randomBytes } from 'node:crypto'
import type { CreateHostLinkDto, HostLinkCreated, HostLinkExpiryMinutes, HostLinkResolved, HostPublic } from '@nodeaccess/shared'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { env } from '../../config/env.js'
import type { HostRow } from '../hosts/host.repository.js'
import type { HostRepository } from '../hosts/host.repository.js'
import type { HostLinkRepository } from './host-link.repository.js'
import type { UserRepository } from '../users/user.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

type HostConnectionMode = 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function buildFrontendBaseUrl(): string {
  const explicit = env.APP_FRONTEND_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const viteApiUrl = process.env.VITE_API_URL?.trim()
  if (viteApiUrl) {
    return viteApiUrl
      .replace(/\/$/, '')
      .replace(/\/api\/v1$/, '')
      .replace(/\/api$/, '')
  }

  return env.APP_URL.replace(/\/$/, '')
}

function buildPublicHost(host: HostRow): HostPublic {
  const connectionMode = (host as HostRow & { connectionMode?: HostConnectionMode }).connectionMode ?? 'DIRECT'
  const hostBastion = host.bastion
  const groupBastion = host.group?.bastion ?? null
  const effectiveBastion = hostBastion ?? groupBastion
  const effectiveBastionSource: HostPublic['effectiveBastionSource'] =
    hostBastion ? 'host' : groupBastion ? 'group' : 'none'

  return {
    id: host.id,
    tenantId: host.tenantId,
    name: host.name,
    ip: host.ip,
    port: host.port,
    sshUser: host.sshUser,
    authType: host.authType === 'PEM' ? 'pem' : host.authType === 'PEM_PASSWORD' ? 'pem_password' : 'password',
    connectionMode: connectionMode.toLowerCase() as HostPublic['connectionMode'],
    scope: host.scope.toLowerCase() as HostPublic['scope'],
    groupId: host.groupId,
    folderId: host.folderId,
    bastionId: host.bastionId,
    effectiveBastionId: effectiveBastion?.id ?? null,
    effectiveBastionName: effectiveBastion?.name ?? null,
    effectiveBastionSource,
    onePasswordRef: host.onePasswordRef,
    trustedHostKeyFingerprint: (host as HostRow & { trustedHostKeyFingerprint?: string | null }).trustedHostKeyFingerprint ?? null,
    trustedHostKeyVerifiedAt: (host as HostRow & { trustedHostKeyVerifiedAt?: Date | null }).trustedHostKeyVerifiedAt ?? null,
    tags: host.tags.map((ht) => ({ id: ht.tag.id, name: ht.tag.name, color: ht.tag.color })),
    createdAt: host.createdAt,
  }
}

export class HostLinkService {
  constructor(
    private readonly hostLinkRepo: HostLinkRepository,
    private readonly hostRepo: HostRepository,
    private readonly userRepo: UserRepository,
    private readonly logRepo: LogRepository,
  ) {}

  async create(
    dto: CreateHostLinkDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostLinkCreated> {
    const host = await this.hostRepo.findById(dto.hostId, tenantId)
    if (!host) throw new NotFoundError('Host')

    const userGroupIds = role === 'USER'
      ? await this.userRepo.findGroupIdsByUser(userId)
      : []

    this.assertCanAccess(host, userId, role, userGroupIds)

    const token = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + dto.expiresInMinutes * 60_000)
    const created = await this.hostLinkRepo.create({
      tenantId,
      hostId: dto.hostId,
      createdByUserId: userId,
      tokenHash: hashToken(token),
      type: 'AUTHENTICATED',
      expiresAt,
    })

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'HOST_LINK_CREATED',
      targetType: 'HostLink',
      targetId: created.id,
      details: JSON.stringify({
        hostId: created.hostId,
        expiresInMinutes: dto.expiresInMinutes,
        type: 'authenticated',
      }),
    }).catch(() => { /* best-effort */ })

    return {
      id: created.id,
      hostId: created.hostId,
      hostName: host.name,
      expiresAt,
      type: 'authenticated',
      url: `${buildFrontendBaseUrl()}/host-links/${token}`,
    }
  }

  async resolve(
    token: string,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostLinkResolved> {
    const row = await this.hostLinkRepo.findByTokenHash(hashToken(token))
    if (!row || row.tenantId !== tenantId) {
      throw new AppError('Link de host inválido', 404, 'HOST_LINK_NOT_FOUND')
    }

    if (row.revokedAt) {
      await this.logDenied(row.id, userId, row.hostId, 'revoked')
      throw new AppError('Este link de host foi revogado', 410, 'HOST_LINK_REVOKED')
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      await this.logDenied(row.id, userId, row.hostId, 'expired')
      throw new AppError('Este link de host expirou', 410, 'HOST_LINK_EXPIRED')
    }

    const userGroupIds = role === 'USER'
      ? await this.userRepo.findGroupIdsByUser(userId)
      : []

    const resolvedHost = await this.hostRepo.findById(row.hostId, tenantId)
    if (!resolvedHost) {
      throw new NotFoundError('Host')
    }
    this.assertCanAccess(resolvedHost, userId, role, userGroupIds)

    await this.hostLinkRepo.markOpened(row.id)
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'HOST_LINK_OPENED',
      targetType: 'HostLink',
      targetId: row.id,
      details: JSON.stringify({
        hostId: row.hostId,
        type: 'authenticated',
      }),
    }).catch(() => { /* best-effort */ })

    return {
      host: buildPublicHost(resolvedHost),
      expiresAt: row.expiresAt,
      type: 'authenticated',
    }
  }

  async revoke(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<void> {
    const row = await this.hostLinkRepo.findById(id)
    if (!row || row.tenantId !== tenantId) {
      throw new AppError('Link de host não encontrado', 404, 'HOST_LINK_NOT_FOUND')
    }
    if (role !== 'ADMIN' && row.createdByUserId !== userId) {
      throw new ForbiddenError('Sem permissão para revogar este link de host')
    }
    await this.hostLinkRepo.revoke(id)
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'HOST_LINK_REVOKED',
      targetType: 'HostLink',
      targetId: id,
      details: JSON.stringify({ tenantId }),
    }).catch(() => { /* best-effort */ })
  }

  private async logDenied(hostLinkId: number, userId: number, hostId: number, reason: string) {
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'HOST_LINK_DENIED',
      targetType: 'HostLink',
      targetId: hostLinkId,
      details: JSON.stringify({ hostId, reason }),
    }).catch(() => { /* best-effort */ })
  }

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
}
