import { Prisma, type PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'

export interface HostCredentials {
  id:                number
  name:              string
  ip:                string
  port:              number
  sshUser:           string
  authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
  connectionMode:    'DIRECT' | 'AGENT'
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
      where: { id, tenantId },
      include: {
        pemKey: { select: { encryptedKey: true, iv: true } },
        bastion: {
          include: { pemKey: { select: { encryptedKey: true, iv: true } } },
        },
      },
    })

    if (!host) return null

    const connectionMode = (host as typeof host & { connectionMode?: 'DIRECT' | 'AGENT' }).connectionMode ?? 'DIRECT'

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
      bastion: host.bastion
        ? {
            ip:                host.bastion.ip,
            port:              host.bastion.port,
            sshUser:           host.bastion.sshUser,
            authType:          host.bastion.authType,
            passwordEncrypted: host.bastion.passwordEncrypted,
            pemKey:            host.bastion.pemKey,
          }
        : null,
    }
  }

  async getUserGroupIds(userId: number): Promise<number[]> {
    const rows = await this.db.userGroup.findMany({
      where: { userId },
      select: { groupId: true },
    })
    return rows.map((r) => r.groupId)
  }

  async startSession(userId: number, hostId: number): Promise<number> {
    const session = await this.db.session.create({
      data: { userId, hostId, active: true },
    })
    return session.id
  }

  async endSession(id: number): Promise<void> {
    await this.db.session.update({
      where: { id },
      data: { active: false, endedAt: new Date() },
    })
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
    return this.db.session.count({ where: { userId, active: true } })
  }

  async countActiveSessionsByTenant(tenantId: number): Promise<number> {
    return this.db.session.count({ where: { active: true, user: { tenantId } } })
  }
}
