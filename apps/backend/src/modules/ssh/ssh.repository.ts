import { Prisma, type PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'
import { endStaleActiveSessions } from '../sessions/session-liveness.js'

type HostConnectionMode = 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO'
type SessionConnectionMethod = 'direct' | 'user_agent' | 'tenant_agent'
type SessionEndedReason =
  | 'socket_closed'
  | 'credential_error'
  | 'agent_required'
  | 'agent_connect_failed'
  | 'host_key_verification_required'
  | 'ssh_bastion_connect_failed'
  | 'ssh_target_connect_failed'
  | 'ssh_connect_failed'

interface SessionOriginMetadata {
  clientIp?: string | null | undefined
  userAgent?: string | null | undefined
}

export interface HostCredentials {
  id:                number
  name:              string
  ip:                string
  port:              number
  sshUser:           string
  authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
  connectionMode:    HostConnectionMode
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
  }> {
    try {
      const license = await this.db.license.findUnique({
        where: { tenantId },
        select: {
          maxActiveSessionsPerUser: true,
          maxActiveSessionsTenant: true,
        },
      })

      return {
        maxPerUser: license?.maxActiveSessionsPerUser ?? null,
        maxPerTenant: license?.maxActiveSessionsTenant ?? null,
      }
    } catch (err) {
      logger.warn(
        { err, tenantId },
        'Ignorando limites de sessão da licença até a migration do banco ser aplicada',
      )

      return {
        maxPerUser: null,
        maxPerTenant: null,
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
    const effectiveBastion = host.bastion ?? host.group?.bastion ?? null
    const registeredBastionPemKey = effectiveBastion
      ? await this.findBastionSystemPemKey(effectiveBastion.id)
      : null

    return {
      id:                host.id,
      name:              host.name,
      ip:                host.ip,
      port:              host.port,
      sshUser:           host.sshUser,
      authType:          host.authType,
      connectionMode:    connectionMode,
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
          started_at,
          last_seen_at
        ) VALUES (
          ${userId},
          ${hostId},
          ${true},
          ${origin.clientIp ?? null},
          ${origin.userAgent ?? null},
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
      agentSource?: 'user' | 'tenant' | null
      agentRemoteIp?: string | null
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
