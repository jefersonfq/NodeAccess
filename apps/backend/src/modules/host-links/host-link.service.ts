import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { CreateHostLinkDto, HostLinkCreated, HostLinkPublicInfo, HostLinkPublicResolved, HostLinkResolved, HostPublic } from '@nodeaccess/shared'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { decrypt, encrypt } from '../../shared/crypto.js'
import { env } from '../../config/env.js'
import type { HostRow } from '../hosts/host.repository.js'
import type { HostRepository } from '../hosts/host.repository.js'
import type { HostLinkRepository } from './host-link.repository.js'
import type { UserRepository } from '../users/user.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

type HostConnectionMode = 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO'
interface HostLinkListItem {
  id: number
  hostId: number
  hostName?: string
  hostIp?: string
  type: 'authenticated' | 'public_once'
  expiresAt: Date
  lastOpenedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  createdBy: { id: number; name: string; email: string }
  activeSessions: number
  status: 'active' | 'used' | 'expired' | 'revoked'
  pinRequired: boolean
  pin: string | null
  url: string | null
}
interface HostLinkPolicyReader {
  findJitAccessSettings(tenantId: number): Promise<{ enabled: boolean; expiryMinutes: number[]; maxExpiryMinutes: number; pinRequired: boolean }>
}
interface HostLinkRuntimeSessionCloser {
  closeByJitLink(jitLinkId: number, reason?: string): number
}
interface HostLinkRevocationPublisher {
  publishRevoked(tenantId: number, linkId: number): Promise<void>
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashPin(pin: string, tokenHash: string): string {
  return createHmac('sha256', env.JWT_SECRET)
    .update(`${tokenHash}:${pin}`)
    .digest('hex')
}

function generateJitPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
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
  const accessProtocol = (host as HostRow & { accessProtocol?: 'SSH' | 'RDP' | 'TELNET' | 'VNC' | 'SERIAL' }).accessProtocol ?? 'SSH'
  const hostBastion = host.bastion
  const groupBastion = host.group?.bastion ?? null
  const effectiveBastion = hostBastion ?? groupBastion
  const effectiveBastionSource: HostPublic['effectiveBastionSource'] =
    hostBastion ? 'host' : groupBastion ? 'group' : 'none'

  return {
    id: host.id,
    tenantId: host.tenantId,
    name: host.name,
    description: host.description ?? null,
    ip: host.ip,
    port: host.port,
    accessProtocol: accessProtocol.toLowerCase() as HostPublic['accessProtocol'],
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
    private readonly policyReader?: HostLinkPolicyReader,
    private readonly runtimeSessionCloser?: HostLinkRuntimeSessionCloser,
    private readonly revocationPublisher?: HostLinkRevocationPublisher,
  ) {}

  async create(
    dto: CreateHostLinkDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    canManageHosts = false,
  ): Promise<HostLinkCreated> {
    const host = await this.hostRepo.findById(dto.hostId, tenantId)
    if (!host) throw new NotFoundError('Host')
    const type = dto.type ?? 'authenticated'

    if (type === 'public_once' && role !== 'ADMIN' && !canManageHosts) {
      throw new ForbiddenError('Sem permissão para gerar link JIT público')
    }
    const jitSettings = type === 'public_once'
      ? await this.getJitAccessSettings(tenantId)
      : null
    if (type === 'public_once') {
      const settings = jitSettings!
      if (!settings.enabled) {
        throw new AppError('Acesso JIT está desabilitado para este tenant', 403, 'HOST_LINK_JIT_DISABLED')
      }
      if (!settings.expiryMinutes.includes(dto.expiresInMinutes)) {
        throw new AppError('Validade não permitida para link JIT', 400, 'HOST_LINK_EXPIRY_NOT_ALLOWED')
      }
    }

    const userGroupIds = role === 'USER'
      ? await this.userRepo.findGroupIdsByUser(userId)
      : []

    this.assertCanAccess(host, userId, role, userGroupIds)

    const token = randomBytes(24).toString('base64url')
    const tokenHash = hashToken(token)
    const encryptedToken = encrypt(token)
    const pin = type === 'public_once' && jitSettings?.pinRequired ? generateJitPin() : undefined
    const encryptedPin = pin ? encrypt(pin) : null
    const expiresAt = new Date(Date.now() + dto.expiresInMinutes * 60_000)
    const created = await this.hostLinkRepo.create({
      tenantId,
      hostId: dto.hostId,
      createdByUserId: userId,
      tokenHash,
      tokenEncrypted: encryptedToken.encrypted,
      tokenIv: encryptedToken.iv,
      pinHash: pin ? hashPin(pin, tokenHash) : null,
      pinEncrypted: encryptedPin?.encrypted ?? null,
      pinIv: encryptedPin?.iv ?? null,
      type: type === 'public_once' ? 'PUBLIC_ONCE' : 'AUTHENTICATED',
      expiresAt,
    })

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: type === 'public_once' ? 'JIT_LINK_CREATED' : 'HOST_LINK_CREATED',
      targetType: 'HostLink',
      targetId: created.id,
      details: JSON.stringify({
        hostId: created.hostId,
        expiresInMinutes: dto.expiresInMinutes,
        type,
        pinRequired: !!pin,
      }),
    }).catch(() => { /* best-effort */ })

    return {
      id: created.id,
      hostId: created.hostId,
      hostName: host.name,
      expiresAt,
      type,
      url: `${buildFrontendBaseUrl()}${type === 'public_once' ? '/jit-access' : '/host-links'}/${token}`,
      ...(pin ? { pin, pinRequired: true } : { pinRequired: false }),
    }
  }

  async getOptions(tenantId: number): Promise<{ jitAccess: { enabled: boolean; expiryMinutes: number[]; maxExpiryMinutes: number; pinRequired: boolean } }> {
    return {
      jitAccess: await this.getJitAccessSettings(tenantId),
    }
  }

  async listForHost(
    hostId: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    canManageHosts = false,
  ): Promise<HostLinkListItem[]> {
    const host = await this.hostRepo.findById(hostId, tenantId)
    if (!host) throw new NotFoundError('Host')

    const userGroupIds = role === 'USER'
      ? await this.userRepo.findGroupIdsByUser(userId)
      : []
    this.assertCanAccess(host, userId, role, userGroupIds)

    const rows = await this.hostLinkRepo.listByHost(tenantId, hostId)
    return rows
      .filter((row) => role === 'ADMIN' || canManageHosts || row.createdByUserId === userId)
      .map((row) => {
        const status = this.resolveStatus(row)
        return {
          id: row.id,
          hostId: row.hostId,
          type: row.type === 'PUBLIC_ONCE' ? 'public_once' : 'authenticated',
          expiresAt: row.expiresAt,
          lastOpenedAt: row.lastOpenedAt,
          revokedAt: row.revokedAt,
          createdAt: row.createdAt,
          createdBy: {
            id: row.createdByUserId,
            name: row.createdByName,
            email: row.createdByEmail,
          },
          activeSessions: Number(row.activeSessions ?? 0),
          status,
          pinRequired: !!row.pinHash,
          pin: status === 'active' ? this.decryptPin(row.pinEncrypted, row.pinIv) : null,
          url: this.buildLinkUrl(row),
        }
      })
  }

  async listTemporary(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    canManageHosts = false,
  ): Promise<HostLinkListItem[]> {
    const rows = await this.hostLinkRepo.listByTenant(tenantId, userId, role, canManageHosts)
    return rows.map((row) => {
      const status = this.resolveStatus(row)
      return {
        id: row.id,
        hostId: row.hostId,
        ...(row.hostName !== undefined && { hostName: row.hostName }),
        ...(row.hostIp !== undefined && { hostIp: row.hostIp }),
        type: row.type === 'PUBLIC_ONCE' ? 'public_once' : 'authenticated',
        expiresAt: row.expiresAt,
        lastOpenedAt: row.lastOpenedAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
        createdBy: {
          id: row.createdByUserId,
          name: row.createdByName,
          email: row.createdByEmail,
        },
        activeSessions: Number(row.activeSessions ?? 0),
        status,
        pinRequired: !!row.pinHash,
        pin: status === 'active' ? this.decryptPin(row.pinEncrypted, row.pinIv) : null,
        url: this.buildLinkUrl(row),
      }
    })
  }

  async getPublicInfo(token: string): Promise<HostLinkPublicInfo> {
    const row = await this.hostLinkRepo.findByTokenHash(hashToken(token))
    if (!row || row.type !== 'PUBLIC_ONCE') {
      throw new AppError('Link JIT inválido', 404, 'HOST_LINK_NOT_FOUND')
    }

    return {
      expiresAt: row.expiresAt,
      pinRequired: !!row.pinHash,
      status: this.resolveStatus(row),
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
    if (row.type !== 'AUTHENTICATED') {
      throw new AppError('Link de host inválido', 404, 'HOST_LINK_NOT_FOUND')
    }

    if (row.revokedAt) {
      await this.logDenied(row.id, userId, row.hostId, 'revoked', row.type)
      throw new AppError('Este link de host foi revogado', 410, 'HOST_LINK_REVOKED')
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      await this.logDenied(row.id, userId, row.hostId, 'expired', row.type)
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

  async resolvePublic(
    token: string,
    guestName: string,
    pin?: string,
    meta: { clientIp?: string; userAgent?: string } = {},
  ): Promise<HostLinkPublicResolved> {
    const row = await this.hostLinkRepo.findByTokenHash(hashToken(token))
    if (!row || row.type !== 'PUBLIC_ONCE') {
      throw new AppError('Link JIT inválido', 404, 'HOST_LINK_NOT_FOUND')
    }

    if (row.revokedAt) {
      await this.logDenied(row.id, row.createdByUserId, row.hostId, 'revoked', row.type)
      throw new AppError('Este link JIT foi revogado', 410, 'HOST_LINK_REVOKED')
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      await this.logDenied(row.id, row.createdByUserId, row.hostId, 'expired', row.type)
      throw new AppError('Este link JIT expirou', 410, 'HOST_LINK_EXPIRED')
    }

    if (row.lastOpenedAt) {
      await this.logDenied(row.id, row.createdByUserId, row.hostId, 'already_used', row.type)
      throw new AppError('Este link JIT já foi utilizado', 410, 'HOST_LINK_ALREADY_USED')
    }

    if (row.pinHash && hashPin((pin ?? '').trim(), row.tokenHash) !== row.pinHash) {
      await this.logDenied(row.id, row.createdByUserId, row.hostId, 'invalid_pin', row.type)
      throw new AppError('PIN inválido para este link JIT', 401, 'HOST_LINK_INVALID_PIN')
    }

    const resolvedHost = await this.hostRepo.findById(row.hostId, row.tenantId)
    if (!resolvedHost) {
      throw new NotFoundError('Host')
    }

    await this.hostLinkRepo.markOpened(row.id)
    await this.logRepo.logAdminEvent({
      adminId: row.createdByUserId,
      action: 'JIT_LINK_OPENED',
      targetType: 'HostLink',
      targetId: row.id,
      details: JSON.stringify({
        hostId: row.hostId,
        type: 'public_once',
        guestName,
        pinRequired: !!row.pinHash,
        clientIp: meta.clientIp ?? null,
        userAgent: meta.userAgent ?? null,
      }),
    }).catch(() => { /* best-effort */ })

    const secondsToExpire = Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000))
    const accessToken = jwt.sign({
      stage: 'jit_host_access',
      sub: String(row.createdByUserId),
      tenantId: row.tenantId,
      hostId: row.hostId,
      linkId: row.id,
      guestName,
    }, env.JWT_SECRET, { expiresIn: secondsToExpire })

    return {
      host: buildPublicHost(resolvedHost),
      expiresAt: row.expiresAt,
      type: 'public_once',
      accessToken,
      guestName,
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
    const closedSessions = row.type === 'PUBLIC_ONCE'
      ? await this.hostLinkRepo.endActiveSessionsByLink(id)
      : 0
    if (row.type === 'PUBLIC_ONCE') {
      this.runtimeSessionCloser?.closeByJitLink(id, 'jit_link_revoked')
      await this.revocationPublisher?.publishRevoked(tenantId, id).catch(() => { /* best-effort */ })
    }
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: row.type === 'PUBLIC_ONCE' ? 'JIT_LINK_REVOKED' : 'HOST_LINK_REVOKED',
      targetType: 'HostLink',
      targetId: id,
      details: JSON.stringify({ tenantId, closedSessions }),
    }).catch(() => { /* best-effort */ })
  }

  private async logDenied(hostLinkId: number, userId: number, hostId: number, reason: string, type: 'AUTHENTICATED' | 'PUBLIC_ONCE') {
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: type === 'PUBLIC_ONCE' ? 'JIT_LINK_DENIED' : 'HOST_LINK_DENIED',
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

  private resolveStatus(row: { type: 'AUTHENTICATED' | 'PUBLIC_ONCE'; revokedAt: Date | null; expiresAt: Date; lastOpenedAt: Date | null }): HostLinkListItem['status'] {
    if (row.revokedAt) return 'revoked'
    if (row.expiresAt.getTime() <= Date.now()) return 'expired'
    if (row.type === 'PUBLIC_ONCE' && row.lastOpenedAt) return 'used'
    return 'active'
  }

  private decryptPin(pinEncrypted: string | null, pinIv: string | null): string | null {
    if (!pinEncrypted || !pinIv) return null
    try {
      return decrypt({ encrypted: pinEncrypted, iv: pinIv })
    } catch {
      return null
    }
  }

  private buildLinkUrl(row: { type: 'AUTHENTICATED' | 'PUBLIC_ONCE'; tokenEncrypted: string | null; tokenIv: string | null }): string | null {
    if (!row.tokenEncrypted || !row.tokenIv) return null
    try {
      const token = decrypt({ encrypted: row.tokenEncrypted, iv: row.tokenIv })
      return `${buildFrontendBaseUrl()}${row.type === 'PUBLIC_ONCE' ? '/jit-access' : '/host-links'}/${token}`
    } catch {
      return null
    }
  }

  private async getJitAccessSettings(tenantId: number): Promise<{ enabled: boolean; expiryMinutes: number[]; maxExpiryMinutes: number; pinRequired: boolean }> {
    return this.policyReader?.findJitAccessSettings(tenantId) ?? {
      enabled: true,
      expiryMinutes: [5, 10, 30],
      maxExpiryMinutes: 30,
      pinRequired: false,
    }
  }
}
