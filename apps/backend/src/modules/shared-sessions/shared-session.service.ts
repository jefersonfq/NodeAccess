import { createHash, randomBytes } from 'node:crypto'
import type {
  CreateSharedSessionDto,
  DenySharedSessionControlDto,
  GrantSharedSessionControlDto,
  HostPublic,
  RevokeSharedSessionControlDto,
  SharedSessionControlActionResult,
  SharedSessionControlLease,
  SharedSessionCreated,
  SharedSessionParticipant,
  SharedSessionPublic,
  RequestSharedSessionControlDto,
  SharedSessionResolved,
} from '@nodeaccess/shared'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { env } from '../../config/env.js'
import type { HostRow, HostRepository } from '../hosts/host.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { SettingsRepository } from '../settings/settings.repository.js'
import type { SharedSessionBroker } from './shared-session.broker.js'
import { decrypt, encrypt } from '../../shared/crypto.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type {
  SharedSessionControlLeaseRow,
  SharedSessionListRow,
  SharedSessionParticipantRow,
  SharedSessionRepository,
  SharedSessionRow,
} from './shared-session.repository.js'

export interface SharedSessionChannelState {
  sharedSession: SharedSessionPublic
  sessionId: number
  role: 'owner' | 'viewer'
}

export interface SharedSessionListItem {
  id: number
  hostId: number
  hostName: string
  hostDeleted: boolean
  sessionId: number
  status: 'active' | 'ended' | 'revoked'
  expiresAt: Date
  createdAt: Date
  owner: {
    userId: number
    name: string
    email: string | null
  }
  activeParticipants: number
  activeControlLease: SharedSessionControlLease | null
  url: string | null
}

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

function toParticipant(row: SharedSessionParticipantRow): SharedSessionParticipant {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role === 'OWNER' ? 'owner' : 'viewer',
    joinedAt: row.joinedAt,
    leftAt: row.leftAt,
    lastSeenAt: row.lastSeenAt,
  }
}

function toControlLease(row: SharedSessionControlLeaseRow): SharedSessionControlLease {
  return {
    id: row.id,
    sharedSessionId: row.sharedSessionId,
    controllerUserId: row.controllerUserId,
    grantedByUserId: row.grantedByUserId,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    endedAt: row.endedAt,
    endReason: row.endReason
      ? row.endReason.toLowerCase() as SharedSessionControlLease['endReason']
      : null,
    revokeReason: row.revokeReason,
  }
}

function buildPublicHost(host: HostRow): HostPublic {
  const connectionMode = (host as HostRow & { connectionMode?: 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO' }).connectionMode ?? 'DIRECT'
  const accessProtocol = (host as HostRow & { accessProtocol?: 'SSH' | 'RDP' | 'TELNET' | 'VNC' | 'SERIAL' }).accessProtocol ?? 'SSH'
  const operatingSystem = (host as HostRow & { operatingSystem?: string }).operatingSystem ?? 'UNKNOWN'
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
    operatingSystem: operatingSystem.toLowerCase() as HostPublic['operatingSystem'],
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

export class SharedSessionService {
  constructor(
    private readonly sharedSessionRepo: SharedSessionRepository,
    private readonly hostRepo: HostRepository,
    private readonly sshRepo: SshRepository,
    private readonly logRepo: LogRepository,
    private readonly settingsRepo: SettingsRepository,
    private readonly sharedSessionBroker?: SharedSessionBroker,
  ) {}

  async create(
    dto: CreateSharedSessionDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<SharedSessionCreated> {
    const activeSession = await this.sharedSessionRepo.findActiveSessionForShare(dto.sessionId, tenantId)
    if (!activeSession || !activeSession.active) {
      throw new NotFoundError('Sessão SSH')
    }
    if (role !== 'ADMIN' && activeSession.ownerUserId !== userId) {
      throw new ForbiddenError('Sem permissão para compartilhar esta sessão')
    }

    const host = await this.hostRepo.findById(activeSession.hostId, tenantId)
    if (!host) throw new NotFoundError('Host')

    const settings = await this.settingsRepo.findSharedSessionSettings(tenantId)
    if (!settings.expiryMinutes.includes(dto.expiresInMinutes)) {
      throw new AppError('Validade de sessão ao vivo não permitida pela política atual', 400, 'SHARED_SESSION_EXPIRY_NOT_ALLOWED')
    }

    await this.assertCanAccess(host, userId, role, tenantId)

    const existingSharedSessions = await this.sharedSessionRepo.listActiveBySessionId(dto.sessionId)
    for (const existingSharedSession of existingSharedSessions) {
      await this.sharedSessionRepo.endActiveControlLease(existingSharedSession.id, 'REVOKED', 'superseded_by_new_shared_session')
      await this.sharedSessionRepo.revoke(existingSharedSession.id)
      this.sharedSessionBroker?.unregisterSharedSession(existingSharedSession.id, existingSharedSession.sessionId)
    }

    const token = randomBytes(24).toString('base64url')
    const encryptedToken = encrypt(token)
    const expiresAt = new Date(Date.now() + dto.expiresInMinutes * 60_000)
    const created = await this.sharedSessionRepo.create({
      tenantId,
      hostId: activeSession.hostId,
      ownerUserId: activeSession.ownerUserId,
      sessionId: dto.sessionId,
      joinTokenHash: hashToken(token),
      tokenEncrypted: encryptedToken.encrypted,
      tokenIv: encryptedToken.iv,
      expiresAt,
    })

    this.sharedSessionBroker?.registerSharedSession(
      created.id,
      created.sessionId,
      created.ownerUserId,
      null,
      dto.initialOutputSnapshot?.trim() || null,
    )

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'SHARED_SESSION_CREATED',
      targetType: 'SharedSession',
      targetId: created.id,
      details: JSON.stringify({
        hostId: created.hostId,
        sessionId: created.sessionId,
        expiresInMinutes: dto.expiresInMinutes,
      }),
    }).catch(() => { /* best-effort */ })

    const participants = await this.sharedSessionRepo.findParticipants(created.id)
    return {
      ...this.toPublic(created, participants),
      joinUrl: `${buildFrontendBaseUrl()}/shared-sessions/${token}`,
    }
  }

  async getById(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<SharedSessionPublic> {
    const { sharedSession } = await this.loadAccessibleSharedSession(id, tenantId, userId, role)
    const participants = await this.sharedSessionRepo.findParticipants(sharedSession.id)
    return this.toPublic(sharedSession, participants, await this.sharedSessionRepo.findActiveControlLease(sharedSession.id))
  }

  async list(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<SharedSessionListItem[]> {
    const rows = await this.sharedSessionRepo.listByTenant(tenantId, userId, role)
    return Promise.all(rows.map(async (row) => this.toListItem(row, await this.sharedSessionRepo.findActiveControlLease(row.id))))
  }

  async resolve(
    token: string,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<SharedSessionResolved> {
    const sharedSession = await this.sharedSessionRepo.findByTokenHash(hashToken(token))
    if (!sharedSession || sharedSession.tenantId !== tenantId) {
      throw new AppError('Sessão compartilhada inválida', 404, 'SHARED_SESSION_NOT_FOUND')
    }

    if (sharedSession.status === 'REVOKED') {
      throw new AppError('Esta sessão compartilhada foi revogada', 410, 'SHARED_SESSION_REVOKED')
    }
    if (sharedSession.status === 'ENDED') {
      throw new AppError('Esta sessão compartilhada já foi encerrada', 410, 'SHARED_SESSION_ENDED')
    }
    if (sharedSession.expiresAt.getTime() <= Date.now()) {
      throw new AppError('Esta sessão compartilhada expirou', 410, 'SHARED_SESSION_EXPIRED')
    }

    const host = await this.hostRepo.findById(sharedSession.hostId, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanAccess(host, userId, role, tenantId)

    await this.sharedSessionRepo.upsertViewerParticipant(sharedSession.id, userId)
    const participants = await this.sharedSessionRepo.findParticipants(sharedSession.id)
    const participant = participants.find((item) => item.userId === userId)

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'SHARED_SESSION_JOINED',
      targetType: 'SharedSession',
      targetId: sharedSession.id,
      details: JSON.stringify({
        hostId: sharedSession.hostId,
        sessionId: sharedSession.sessionId,
        role: participant?.role === 'OWNER' ? 'owner' : 'viewer',
      }),
    }).catch(() => { /* best-effort */ })

    return {
      sharedSessionId: sharedSession.id,
      role: participant?.role === 'OWNER' ? 'owner' : 'viewer',
      host: buildPublicHost(host),
      hostDeleted: Boolean(sharedSession.hostDeleted),
      owner: {
        userId: sharedSession.ownerUserId,
        name: sharedSession.ownerName,
        email: sharedSession.ownerEmail,
      },
      expiresAt: sharedSession.expiresAt,
      wsChannel: `shared-session:${sharedSession.id}`,
      activeControlLease: await this.getActiveControlLeasePublic(sharedSession.id),
      pendingControlRequestUserIds: this.sharedSessionBroker?.getPendingControlRequestUserIds(sharedSession.id) ?? [],
    }
  }

  async revoke(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<void> {
    const sharedSession = await this.sharedSessionRepo.findById(id)
    if (!sharedSession || sharedSession.tenantId !== tenantId) {
      throw new NotFoundError('Sessão compartilhada')
    }
    if (role !== 'ADMIN' && sharedSession.ownerUserId !== userId) {
      throw new ForbiddenError('Sem permissão para encerrar esta sessão compartilhada')
    }

    await this.sharedSessionRepo.revoke(id)
    await this.sharedSessionRepo.endActiveControlLease(id, 'REVOKED', 'shared_session_revoked')
    this.sharedSessionBroker?.unregisterSharedSession(id, sharedSession.sessionId)
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'SHARED_SESSION_REVOKED',
      targetType: 'SharedSession',
      targetId: id,
      details: JSON.stringify({
        hostId: sharedSession.hostId,
        sessionId: sharedSession.sessionId,
      }),
    }).catch(() => { /* best-effort */ })
  }

  async joinChannel(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<SharedSessionChannelState> {
    const sharedSession = await this.sharedSessionRepo.findById(id)
    if (!sharedSession || sharedSession.tenantId !== tenantId) {
      throw new AppError('Sessão compartilhada inválida', 404, 'SHARED_SESSION_NOT_FOUND')
    }

    if (sharedSession.status === 'REVOKED') {
      throw new AppError('Esta sessão compartilhada foi revogada', 410, 'SHARED_SESSION_REVOKED')
    }
    if (sharedSession.status === 'ENDED') {
      throw new AppError('Esta sessão compartilhada já foi encerrada', 410, 'SHARED_SESSION_ENDED')
    }
    if (sharedSession.expiresAt.getTime() <= Date.now()) {
      throw new AppError('Esta sessão compartilhada expirou', 410, 'SHARED_SESSION_EXPIRED')
    }

    const host = await this.hostRepo.findById(sharedSession.hostId, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanAccess(host, userId, role, tenantId)

    if (sharedSession.ownerUserId !== userId) {
      await this.sharedSessionRepo.upsertViewerParticipant(sharedSession.id, userId)
      await this.logRepo.logAdminEvent({
        adminId: userId,
        action: 'SHARED_SESSION_JOINED',
        targetType: 'SharedSession',
        targetId: sharedSession.id,
        details: JSON.stringify({
          hostId: sharedSession.hostId,
          sessionId: sharedSession.sessionId,
          role: 'viewer',
        }),
      }).catch(() => { /* best-effort */ })
    } else {
      await this.sharedSessionRepo.touchParticipant(sharedSession.id, userId)
    }

    const participants = await this.sharedSessionRepo.findParticipants(sharedSession.id)
    const participant = participants.find((item) => item.userId === userId)

    return {
      sharedSession: this.toPublic(sharedSession, participants, await this.sharedSessionRepo.findActiveControlLease(sharedSession.id)),
      sessionId: sharedSession.sessionId,
      role: participant?.role === 'OWNER' ? 'owner' : 'viewer',
    }
  }

  async touchChannelParticipant(id: number, userId: number): Promise<boolean> {
    const sharedSession = await this.sharedSessionRepo.findById(id)
    if (!sharedSession || sharedSession.status !== 'ACTIVE' || sharedSession.expiresAt.getTime() <= Date.now()) {
      return false
    }
    await this.sharedSessionRepo.touchParticipant(id, userId)
    return true
  }

  async leaveChannel(id: number, userId: number): Promise<void> {
    await this.sharedSessionRepo.markParticipantLeft(id, userId)
    this.sharedSessionBroker?.clearPendingControlRequest(id, userId)

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'SHARED_SESSION_LEFT',
      targetType: 'SharedSession',
      targetId: id,
    }).catch(() => { /* best-effort */ })
  }

  async requestControl(
    id: number,
    _dto: RequestSharedSessionControlDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<SharedSessionControlActionResult> {
    const { sharedSession } = await this.loadAccessibleSharedSession(id, tenantId, userId, role)
    if (sharedSession.ownerUserId === userId) {
      throw new ForbiddenError('O owner já possui o controle desta sessão')
    }

    const participant = await this.sharedSessionRepo.findParticipant(sharedSession.id, userId)
    if (!participant || participant.role !== 'VIEWER' || participant.leftAt) {
      throw new ForbiddenError('Somente participantes viewers ativos podem solicitar controle')
    }

    const activeLease = await this.sharedSessionRepo.findActiveControlLease(sharedSession.id)
    if (activeLease) {
      throw new AppError('Já existe um controlador ativo nesta sessão', 409, 'SHARED_SESSION_CONTROL_ALREADY_GRANTED')
    }

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'SHARED_SESSION_CONTROL_REQUESTED',
      targetType: 'SharedSession',
      targetId: sharedSession.id,
      details: JSON.stringify({
        hostId: sharedSession.hostId,
        sessionId: sharedSession.sessionId,
        requestedBy: userId,
      }),
    }).catch(() => { /* best-effort */ })

    this.sharedSessionBroker?.publishControlRequested(sharedSession.id, { userId })

    return {
      sharedSessionId: sharedSession.id,
      status: 'requested',
    }
  }

  async grantControl(
    id: number,
    targetUserId: number,
    dto: GrantSharedSessionControlDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<SharedSessionControlActionResult> {
    const { sharedSession } = await this.loadAccessibleSharedSession(id, tenantId, userId, role)
    this.assertCanManageControl(sharedSession, userId, role)

    const participant = await this.sharedSessionRepo.findParticipant(sharedSession.id, targetUserId)
    if (!participant || participant.role !== 'VIEWER' || participant.leftAt) {
      throw new NotFoundError('Participante da sessão compartilhada')
    }

    const existingLease = await this.sharedSessionRepo.findActiveControlLease(sharedSession.id)
    if (existingLease) {
      throw new AppError('Já existe um controlador ativo nesta sessão', 409, 'SHARED_SESSION_CONTROL_ALREADY_GRANTED')
    }

    const expiresAt = new Date(Date.now() + dto.leaseMinutes * 60_000)
    const createdLease = await this.sharedSessionRepo.createControlLease({
      sharedSessionId: sharedSession.id,
      controllerUserId: targetUserId,
      grantedByUserId: userId,
      expiresAt,
    })

    this.sharedSessionBroker?.registerSharedSession(
      sharedSession.id,
      sharedSession.sessionId,
      sharedSession.ownerUserId,
      toControlLease(createdLease),
    )

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'SHARED_SESSION_CONTROL_GRANTED',
      targetType: 'SharedSession',
      targetId: sharedSession.id,
      details: JSON.stringify({
        hostId: sharedSession.hostId,
        sessionId: sharedSession.sessionId,
        controllerUserId: targetUserId,
        grantedByUserId: userId,
        leaseStartedAt: createdLease.startedAt,
        leaseExpiresAt: createdLease.expiresAt,
      }),
    }).catch(() => { /* best-effort */ })

    this.sharedSessionBroker?.publishControlGranted(sharedSession.id, toControlLease(createdLease))

    return {
      sharedSessionId: sharedSession.id,
      status: 'granted',
      activeControlLease: toControlLease(createdLease),
    }
  }

  async denyControl(
    id: number,
    targetUserId: number,
    dto: DenySharedSessionControlDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<SharedSessionControlActionResult> {
    const { sharedSession } = await this.loadAccessibleSharedSession(id, tenantId, userId, role)
    this.assertCanManageControl(sharedSession, userId, role)

    const participant = await this.sharedSessionRepo.findParticipant(sharedSession.id, targetUserId)
    if (!participant || participant.role !== 'VIEWER') {
      throw new NotFoundError('Participante da sessão compartilhada')
    }

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'SHARED_SESSION_CONTROL_DENIED',
      targetType: 'SharedSession',
      targetId: sharedSession.id,
      details: JSON.stringify({
        hostId: sharedSession.hostId,
        sessionId: sharedSession.sessionId,
        requestedBy: targetUserId,
        approvedBy: userId,
        reason: dto.reason ?? null,
      }),
    }).catch(() => { /* best-effort */ })

    this.sharedSessionBroker?.publishControlDenied(sharedSession.id, {
      userId: targetUserId,
      reason: dto.reason ?? null,
    })

    return {
      sharedSessionId: sharedSession.id,
      status: 'denied',
      activeControlLease: await this.getActiveControlLeasePublic(sharedSession.id),
    }
  }

  async revokeControl(
    id: number,
    dto: RevokeSharedSessionControlDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<SharedSessionControlActionResult> {
    const { sharedSession } = await this.loadAccessibleSharedSession(id, tenantId, userId, role)
    this.assertCanManageControl(sharedSession, userId, role)

    const activeLease = await this.sharedSessionRepo.findActiveControlLease(sharedSession.id)
    if (!activeLease) {
      throw new NotFoundError('Controle ativo da sessão compartilhada')
    }

    await this.sharedSessionRepo.endActiveControlLease(sharedSession.id, 'REVOKED', dto.reason)
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'SHARED_SESSION_CONTROL_REVOKED',
      targetType: 'SharedSession',
      targetId: sharedSession.id,
      details: JSON.stringify({
        hostId: sharedSession.hostId,
        sessionId: sharedSession.sessionId,
        controllerUserId: activeLease.controllerUserId,
        approvedBy: userId,
        leaseStartedAt: activeLease.startedAt,
        leaseExpiresAt: activeLease.expiresAt,
        reason: dto.reason ?? null,
      }),
    }).catch(() => { /* best-effort */ })

    this.sharedSessionBroker?.publishControlRevoked(sharedSession.id, {
      userId: activeLease.controllerUserId,
      reason: dto.reason ?? null,
    })

    return {
      sharedSessionId: sharedSession.id,
      status: 'revoked',
      activeControlLease: null,
    }
  }

  private toPublic(
    sharedSession: SharedSessionRow,
    participants: SharedSessionParticipantRow[],
    activeControlLease?: SharedSessionControlLeaseRow | null,
  ): SharedSessionPublic {
    return {
      id: sharedSession.id,
      tenantId: sharedSession.tenantId,
      hostId: sharedSession.hostId,
      hostName: sharedSession.hostName,
      hostDeleted: Boolean(sharedSession.hostDeleted),
      sessionId: sharedSession.sessionId,
      status: sharedSession.status === 'ACTIVE' && sharedSession.expiresAt.getTime() <= Date.now()
        ? 'ended'
        : sharedSession.status === 'ACTIVE'
        ? 'active'
        : sharedSession.status === 'ENDED'
          ? 'ended'
          : 'revoked',
      expiresAt: sharedSession.expiresAt,
      createdAt: sharedSession.createdAt,
      owner: {
        userId: sharedSession.ownerUserId,
        name: sharedSession.ownerName,
        email: sharedSession.ownerEmail,
      },
      participants: participants.map(toParticipant),
      activeControlLease: activeControlLease ? toControlLease(activeControlLease) : null,
      pendingControlRequestUserIds: this.sharedSessionBroker?.getPendingControlRequestUserIds(sharedSession.id) ?? [],
    }
  }

  private toListItem(
    sharedSession: SharedSessionListRow,
    activeControlLease?: SharedSessionControlLeaseRow | null,
  ): SharedSessionListItem {
    return {
      id: sharedSession.id,
      hostId: sharedSession.hostId,
      hostName: sharedSession.hostName,
      hostDeleted: Boolean(sharedSession.hostDeleted),
      sessionId: sharedSession.sessionId,
      status: sharedSession.status === 'ACTIVE'
        ? 'active'
        : sharedSession.status === 'ENDED'
          ? 'ended'
          : 'revoked',
      expiresAt: sharedSession.expiresAt,
      createdAt: sharedSession.createdAt,
      owner: {
        userId: sharedSession.ownerUserId,
        name: sharedSession.ownerName,
        email: sharedSession.ownerEmail,
      },
      activeParticipants: Number(sharedSession.activeParticipants ?? 0),
      activeControlLease: activeControlLease ? toControlLease(activeControlLease) : null,
      url: this.buildJoinUrl(sharedSession),
    }
  }

  private buildJoinUrl(sharedSession: { tokenEncrypted: string | null; tokenIv: string | null }): string | null {
    if (!sharedSession.tokenEncrypted || !sharedSession.tokenIv) return null
    try {
      const token = decrypt({ encrypted: sharedSession.tokenEncrypted, iv: sharedSession.tokenIv })
      return `${buildFrontendBaseUrl()}/shared-sessions/${token}`
    } catch {
      return null
    }
  }

  private async getActiveControlLeasePublic(sharedSessionId: number): Promise<SharedSessionControlLease | null> {
    const active = await this.sharedSessionRepo.findActiveControlLease(sharedSessionId)
    return active ? toControlLease(active) : null
  }

  private async loadAccessibleSharedSession(
    id: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<{ sharedSession: SharedSessionRow; host: HostRow }> {
    const sharedSession = await this.sharedSessionRepo.findById(id)
    if (!sharedSession || sharedSession.tenantId !== tenantId) {
      throw new NotFoundError('Sessão compartilhada')
    }

    const host = await this.hostRepo.findById(sharedSession.hostId, tenantId)
    if (!host) throw new NotFoundError('Host')

    await this.assertCanAccess(host, userId, role, tenantId)

    return { sharedSession, host }
  }

  private assertCanManageControl(
    sharedSession: SharedSessionRow,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): void {
    if (role === 'ADMIN') return
    if (sharedSession.ownerUserId === userId) return
    throw new ForbiddenError('Sem permissão para gerenciar o controle desta sessão compartilhada')
  }

  private async assertCanAccess(
    host: HostRow,
    userId: number,
    role: 'ADMIN' | 'USER',
    tenantId: number,
  ): Promise<void> {
    const canConnect = await this.sshRepo.hasEffectiveHostPermission(host.id, tenantId, userId, 'connect', role)
    if (!canConnect) throw new ForbiddenError('Sem permissão para conectar a este host')
  }
}
