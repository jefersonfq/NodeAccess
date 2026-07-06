import { Prisma, type PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'
import { env } from '../../config/env.js'
import { endStaleActiveSessions } from '../sessions/session-liveness.js'

type HostConnectionMode = 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'PRIVATE_ACCESS_CONNECTOR' | 'AUTO'
type HostAccessProtocol = 'SSH' | 'RDP' | 'TELNET' | 'VNC' | 'SERIAL'
type SessionConnectionMethod = 'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector' | 'native_ssh_gateway' | 'telnet_direct' | 'telnet_user_agent' | 'telnet_tenant_agent' | 'rdp_gateway_pending' | 'vnc_gateway_pending'
type SessionEndedReason =
  | 'socket_closed'
  | 'remote_closed'
  | 'credential_error'
  | 'agent_required'
  | 'agent_connect_failed'
  | 'host_key_verification_required'
  | 'ssh_bastion_connect_failed'
  | 'ssh_target_connect_failed'
  | 'ssh_connect_failed'
  | 'jit_link_revoked'
  | 'jit_link_expired'
  | 'graphical_gateway_pending'
  | 'user_closed'
  | 'admin_closed'

interface SessionOriginMetadata {
  clientIp?: string | null | undefined
  userAgent?: string | null | undefined
  connectionMethod?: SessionConnectionMethod | undefined
  accessType?: 'authenticated' | 'jit_public_link' | undefined
  jitLinkId?: number | null | undefined
  jitGuestName?: string | null | undefined
}

export interface HostCredentials {
  id:                number
  name:              string
  ip:                string
  port:              number
  accessProtocol:    HostAccessProtocol
  sshUser:           string
  authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
  connectionMode:    HostConnectionMode
  privateAccessConnectorId: number | null
  passwordEncrypted: string | null
  onePasswordRef:    string | null
  trustedHostKeyFingerprint: string | null
  scope:             'PERSONAL' | 'TEAM' | 'GLOBAL'
  ownerId:           number | null
  groupId:           number | null
  tenantId:          number
  pemKey:            { encryptedKey: string; iv: string } | null
  bastion: {
    ip:                string
    port:              number
    sshUser:           string
    authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
    passwordEncrypted: string | null
    pemKey:            { encryptedKey: string; iv: string } | null
  } | null
}

export interface RouteSnapshot {
  requestedConnectionMode: HostConnectionMode
  connectionMethod: SessionConnectionMethod
  agentId: number | null
  agentName: string | null
  agentType: string | null
  agentMode: string | null
  agentSource: 'user' | 'tenant' | 'private_access' | null
  agentOwnerUserId: number | null
  agentRemoteIp: string | null
  privateAccess: {
    hostConnectorId: number | null
    selectedBy: 'host_binding' | 'scope_auto' | null
    siteName: string | null
    environment: string | null
    allowedCidrs: string[]
    allowedHostnames: string[]
    allowedPorts: number[]
    allowedHostTags: string[]
    allowFallback: boolean
  } | null
}

export interface NativeSshUser {
  id: number
  email: string
  name: string
  role: 'ADMIN' | 'USER'
  tenantId: number
  passwordHash: string | null
  active: boolean
  lockedUntil: Date | null
  mfaEnabled: boolean
  mfaSecret: string | null
}

export interface NativeSshHostSummary {
  id: number
  name: string
  ip: string
  port: number
  sshUser: string
  scope: 'PERSONAL' | 'TEAM' | 'GLOBAL'
  groupName: string | null
  folderName: string | null
  tags: string[]
}

export class SshRepository {
  constructor(private readonly db: PrismaClient) {}

  async findUserSnapshot(userId: number, tenantId: number): Promise<{ name: string; email: string } | null> {
    return this.db.user.findFirst({
      where: { id: userId, tenantId },
      select: { name: true, email: true },
    })
  }

  async getSessionLimits(tenantId: number): Promise<{
    maxPerUser: number | null
    maxPerTenant: number | null
    multiConnect: boolean
  }> {
    try {
      const license = await this.db.license.findUnique({
        where: { tenantId },
        select: {
          multiConnect: true,
          maxActiveSessionsPerUser: true,
          maxActiveSessionsTenant: true,
        },
      })
      const multiConnect =
        env.NODE_ENV === 'development'
          ? (env.LICENSE_MULTI_CONNECT || license?.multiConnect || false)
          : (license?.multiConnect ?? env.LICENSE_MULTI_CONNECT)

      return {
        maxPerUser: license?.maxActiveSessionsPerUser ?? null,
        maxPerTenant: license?.maxActiveSessionsTenant ?? null,
        multiConnect,
      }
    } catch (err) {
      logger.warn(
        { err, tenantId },
        'Ignorando limites de sessão da licença até a migration do banco ser aplicada',
      )

      return {
        maxPerUser: null,
        maxPerTenant: null,
        multiConnect: env.LICENSE_MULTI_CONNECT,
      }
    }
  }

  async findHostWithCredentials(id: number, tenantId: number): Promise<HostCredentials | null> {
    const host = await this.db.host.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        pemKey: { select: { encryptedKey: true, iv: true } },
        bastion: {
          include: { pemKey: { select: { encryptedKey: true, iv: true } } },
        },
        group: {
          include: {
            bastion: {
              include: { pemKey: { select: { encryptedKey: true, iv: true } } },
            },
          },
        },
      },
    })

    if (!host) return null

    const connectionMode = (host as typeof host & { connectionMode?: HostConnectionMode }).connectionMode ?? 'DIRECT'
    const privateAccessRows = await this.db.$queryRaw<Array<{ privateAccessConnectorId: number | null }>>(Prisma.sql`
      SELECT private_access_connector_id AS privateAccessConnectorId
      FROM hosts
      WHERE id = ${host.id}
      LIMIT 1
    `)
    const effectiveBastion = host.bastion ?? host.group?.bastion ?? null
    const registeredBastionPemKey = effectiveBastion
      ? await this.findBastionSystemPemKey(effectiveBastion.id)
      : null

    return {
      id:                host.id,
      name:              host.name,
      ip:                host.ip,
      port:              host.port,
      accessProtocol:    (host as typeof host & { accessProtocol?: HostAccessProtocol }).accessProtocol ?? 'SSH',
      sshUser:           host.sshUser,
      authType:          host.authType,
      connectionMode:    connectionMode,
      privateAccessConnectorId: privateAccessRows[0]?.privateAccessConnectorId ?? null,
      passwordEncrypted: host.passwordEncrypted,
      onePasswordRef:    host.onePasswordRef,
      trustedHostKeyFingerprint: host.trustedHostKeyFingerprint,
      scope:             host.scope,
      ownerId:           host.ownerId,
      groupId:           host.groupId,
      tenantId:          host.tenantId,
      pemKey:            host.pemKey,
      bastion: effectiveBastion
        ? {
            ip:                effectiveBastion.ip,
            port:              effectiveBastion.port,
            sshUser:           effectiveBastion.sshUser,
            authType:          effectiveBastion.authType,
            passwordEncrypted: effectiveBastion.passwordEncrypted,
            pemKey:            registeredBastionPemKey ?? effectiveBastion.pemKey,
          }
        : null,
    }
  }

  async findNativeSshUserByLogin(login: string): Promise<NativeSshUser | null> {
    const normalized = login.trim()
    if (!normalized) return null

    const where = normalized.includes('@')
      ? { email: normalized }
      : { email: { startsWith: `${normalized}@` } }

    const users = await this.db.user.findMany({
      where,
      take: 2,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        passwordHash: true,
        active: true,
        lockedUntil: true,
        mfaEnabled: true,
        mfaSecret: true,
      },
    })

    if (users.length !== 1) return null
    return users[0] ?? null
  }

  async listAccessibleHosts(
    userId: number,
    tenantId: number,
    role: 'ADMIN' | 'USER',
    query?: string,
    limit = 20,
  ): Promise<NativeSshHostSummary[]> {
    const userGroupIds = role === 'ADMIN' ? [] : await this.getUserGroupIds(userId)
    const trimmedQuery = query?.trim()
    const hosts = await this.db.host.findMany({
      where: {
        tenantId,
        deletedAt: null,
        AND: [
          ...(role !== 'ADMIN'
            ? [{
                OR: [
                  { scope: 'PERSONAL' as const, ownerId: userId },
                  { scope: 'GLOBAL' as const },
                  ...(userGroupIds.length > 0
                    ? [{ scope: 'TEAM' as const, groupId: { in: userGroupIds } }]
                    : []),
                ],
              }]
            : []),
          ...(trimmedQuery
            ? [{
                OR: [
                  { name: { contains: trimmedQuery } },
                  { ip: { contains: trimmedQuery } },
                  { group: { name: { contains: trimmedQuery } } },
                  { folder: { name: { contains: trimmedQuery } } },
                  { tags: { some: { tag: { name: { contains: trimmedQuery } } } } },
                ],
              }]
            : []),
        ],
      },
      orderBy: { name: 'asc' },
      take: limit,
      select: {
        id: true,
        name: true,
        ip: true,
        port: true,
        sshUser: true,
        scope: true,
        group: { select: { name: true } },
        folder: { select: { name: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    })

    return hosts.map((host) => ({
      id: host.id,
      name: host.name,
      ip: host.ip,
      port: host.port,
      sshUser: host.sshUser,
      scope: host.scope,
      groupName: host.group?.name ?? null,
      folderName: host.folder?.name ?? null,
      tags: host.tags.map((item) => item.tag.name).sort((a, b) => a.localeCompare(b)),
    }))
  }

  async resolveAccessibleHost(
    target: string,
    userId: number,
    tenantId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostCredentials | null> {
    const trimmed = target.trim()
    if (!trimmed) return null

    const userGroupIds = role === 'ADMIN' ? [] : await this.getUserGroupIds(userId)
    const idMatch = trimmed.match(/^#?(\d+)$/)
    const hosts = await this.db.host.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          ...(idMatch ? [{ id: Number(idMatch[1]) }] : []),
          { name: trimmed },
          { ip: trimmed },
        ],
        ...(role !== 'ADMIN' && {
          AND: [{
            OR: [
              { scope: 'PERSONAL', ownerId: userId },
              { scope: 'GLOBAL' },
              ...(userGroupIds.length > 0
                ? [{ scope: 'TEAM' as const, groupId: { in: userGroupIds } }]
                : []),
            ],
          }],
        }),
      },
      select: { id: true },
      take: 2,
    })

    const host = hosts[0]
    if (hosts.length !== 1 || !host) return null
    return this.findHostWithCredentials(host.id, tenantId)
  }

  private async findBastionSystemPemKey(
    bastionId: number,
  ): Promise<{ encryptedKey: string; iv: string } | null> {
    const rows = await this.db.$queryRaw<Array<{ encryptedKey: string; iv: string }>>(
      Prisma.sql`
        SELECT pk.encrypted_key AS encryptedKey, pk.iv
        FROM bastion_hosts b
        INNER JOIN pem_keys pk ON pk.id = b.system_pem_key_id
        WHERE b.id = ${bastionId}
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  async getUserGroupIds(userId: number): Promise<number[]> {
    const rows = await this.db.userGroup.findMany({
      where: { userId },
      select: { groupId: true },
    })
    return rows.map((r) => r.groupId)
  }

  async startSession(userId: number, hostId: number, origin: SessionOriginMetadata = {}): Promise<number> {
    const rows = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO sessions (
          user_id,
          host_id,
          active,
          client_ip,
          user_agent,
          access_type,
          jit_link_id,
          jit_guest_name,
          connection_method,
        started_at,
        last_seen_at
      ) VALUES (
          ${userId},
          ${hostId},
          ${true},
          ${origin.clientIp ?? null},
          ${origin.userAgent ?? null},
          ${origin.accessType ?? 'authenticated'},
          ${origin.jitLinkId ?? null},
          ${origin.jitGuestName ?? null},
          ${origin.connectionMethod ?? 'direct'},
          NOW(),
          NOW()
        )
      `)

      return tx.$queryRaw<Array<{ id: bigint | number }>>(Prisma.sql`SELECT LAST_INSERT_ID() AS id`)
    })

    return Number(rows[0]?.id)
  }

  async updateSessionRoute(
    sessionId: number,
    input: {
      requestedConnectionMode: HostConnectionMode
      connectionMethod: SessionConnectionMethod
      agentId?: number | null
      agentName?: string | null
      agentSource?: 'user' | 'tenant' | 'private_access' | null
      agentRemoteIp?: string | null
      routeSnapshot?: RouteSnapshot | null
    },
  ): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE sessions
      SET
        requested_connection_mode = ${input.requestedConnectionMode},
        connection_method = ${input.connectionMethod},
        agent_id = ${input.agentId ?? null},
        agent_name_snapshot = ${input.agentName ?? null},
        agent_source = ${input.agentSource ?? null},
        route_snapshot_json = ${input.routeSnapshot ? JSON.stringify(input.routeSnapshot) : null},
        agent_remote_ip = ${input.agentRemoteIp ?? null}
      WHERE id = ${sessionId}
    `)
  }

  async endSession(
    id: number,
    diagnostics?: {
      endedReason?: SessionEndedReason
      errorCode?: string | null
      errorMessage?: string | null
    },
  ): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE sessions
      SET
        active = false,
        ended_at = ${new Date()},
        ended_reason = ${diagnostics?.endedReason ?? null},
        error_code = ${diagnostics?.errorCode ?? null},
        error_message = ${diagnostics?.errorMessage ?? null}
      WHERE id = ${id}
    `)
  }

  async touchSession(id: number): Promise<void> {
    await this.db.$executeRaw`
      UPDATE sessions
      SET last_seen_at = ${new Date()}
      WHERE id = ${id}
    `
  }

  async getAutoStartForwardings(hostId: number): Promise<Array<{
    id: number; bindAddress: string; localPort: number; remoteHost: string; remotePort: number; description: string | null
  }>> {
    return this.db.$queryRaw<Array<{
      id: number
      bindAddress: string
      localPort: number
      remoteHost: string
      remotePort: number
      description: string | null
    }>>(Prisma.sql`
      SELECT
        id,
        bind_address AS bindAddress,
        local_port AS localPort,
        remote_host AS remoteHost,
        remote_port AS remotePort,
        description
      FROM port_forwardings
      WHERE host_id = ${hostId} AND auto_start = true
    `)
  }

  async countActiveSessionsByUser(userId: number): Promise<number> {
    await endStaleActiveSessions(this.db)
    return this.db.session.count({ where: { userId, active: true } })
  }

  async countActiveSessionsByTenant(tenantId: number): Promise<number> {
    await endStaleActiveSessions(this.db)
    return this.db.session.count({ where: { active: true, user: { tenantId } } })
  }
}
