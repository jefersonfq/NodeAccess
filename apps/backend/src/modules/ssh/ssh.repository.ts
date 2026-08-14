import { Prisma, type PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'
import { env } from '../../config/env.js'
import { endStaleActiveSessions } from '../sessions/session-liveness.js'
import type { InventoryAclRepository } from '../inventory/inventory-acl.repository.js'

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
  | 'acl_revoked'

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
  pemKey:            { encryptedKey: string; iv: string; encryptedPassphrase?: string | null; passphraseIv?: string | null } | null
  bastion: {
    ip:                string
    port:              number
    sshUser:           string
    authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
    passwordEncrypted: string | null
    pemKey:            { encryptedKey: string; iv: string; encryptedPassphrase?: string | null; passphraseIv?: string | null } | null
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
  constructor(
    private readonly db: PrismaClient,
    private readonly inventoryAclRepo?: InventoryAclRepository,
  ) {}

  async hasEffectiveHostPermission(
    hostId: number,
    tenantId: number,
    userId: number,
    permission: 'view' | 'connect' | 'edit' | 'admin',
    role?: 'ADMIN' | 'USER',
  ): Promise<boolean> {
    if (role === 'ADMIN') return true
    if (this.inventoryAclRepo) {
      const rows = await this.inventoryAclRepo.findEffectiveHostPermissions([hostId], tenantId, userId)
      const permissions = rows[0]
      if (!permissions) return false
      const permissionValue = {
        view: permissions.canView,
        connect: permissions.canConnect,
        edit: permissions.canEdit,
        admin: permissions.canAdmin,
      }[permission]
      return Boolean(permissionValue)
    }

    const permissionColumn = {
      view: 'can_view',
      connect: 'can_connect',
      edit: 'can_edit',
      admin: 'can_admin',
    }[permission]
    const rows = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT node.id, node.parent_id, 1 AS is_local
        FROM inventory_nodes node
        INNER JOIN hosts host ON host.id = node.host_id
        WHERE host.id = ${hostId}
          AND host.tenant_id = ${tenantId}
          AND host.deleted_at IS NULL
          AND node.tenant_id = ${tenantId}
          AND node.deleted_at IS NULL

        UNION ALL

        SELECT parent.id, parent.parent_id, 0 AS is_local
        FROM inventory_nodes parent
        INNER JOIN ancestors child ON child.parent_id = parent.id
        WHERE parent.tenant_id = ${tenantId}
          AND parent.deleted_at IS NULL
      )
      SELECT COUNT(*) AS total
      FROM ancestors
      INNER JOIN resource_acl_entries acl
        ON acl.inventory_node_id = ancestors.id
       AND acl.tenant_id = ${tenantId}
      INNER JOIN users target_user
        ON target_user.id = ${userId}
       AND target_user.tenant_id = ${tenantId}
       AND target_user.deleted_at IS NULL
      WHERE (ancestors.is_local = 1 OR acl.inherit_to_children = true)
        AND acl.${Prisma.raw(permissionColumn)} = true
        AND (
          (acl.principal_type = 'USER' AND acl.principal_id = target_user.id)
          OR (
            acl.principal_type = 'GROUP'
            AND EXISTS (
              SELECT 1
              FROM user_groups ug
              INNER JOIN \`groups\` g ON g.id = ug.group_id
              WHERE ug.user_id = target_user.id
                AND ug.group_id = acl.principal_id
                AND g.tenant_id = ${tenantId}
            )
          )
          OR (
            acl.principal_type = 'ROLE'
            AND (
              acl.principal_id = 1
              OR (acl.principal_id = 2 AND target_user.role = 'ADMIN')
            )
          )
        )
    `)
    return Number(rows[0]?.total ?? 0) > 0
  }

  async findHostIdsWithEffectivePermission(
    hostIds: number[],
    tenantId: number,
    userId: number,
    permission: 'view' | 'connect' | 'edit' | 'admin',
    role?: 'ADMIN' | 'USER',
  ): Promise<Set<number>> {
    const uniqueHostIds = [...new Set(hostIds.map((hostId) => Number(hostId)).filter((hostId) => Number.isInteger(hostId) && hostId > 0))]
    if (uniqueHostIds.length === 0) return new Set()
    if (role === 'ADMIN') return new Set(uniqueHostIds)

    if (this.inventoryAclRepo) {
      const rows = await this.inventoryAclRepo.findEffectiveHostPermissions(uniqueHostIds, tenantId, userId)
      return new Set(rows
        .filter((row) => Boolean({
          view: row.canView,
          connect: row.canConnect,
          edit: row.canEdit,
          admin: row.canAdmin,
        }[permission]))
        .map((row) => Number(row.hostId)))
    }

    const checked = await Promise.all(uniqueHostIds.map(async (hostId) => ({
      hostId,
      allowed: await this.hasEffectiveHostPermission(hostId, tenantId, userId, permission, role),
    })))
    return new Set(checked.filter((item) => item.allowed).map((item) => item.hostId))
  }

  async countHostsWithEffectivePermission(
    tenantId: number,
    userId: number,
    permission: 'view' | 'connect' | 'edit' | 'admin',
    role?: 'ADMIN' | 'USER',
  ): Promise<number> {
    if (role === 'ADMIN') {
      return this.db.host.count({ where: { tenantId, deletedAt: null } })
    }

    if (this.inventoryAclRepo) {
      return this.inventoryAclRepo.countHostsWithEffectivePermission(tenantId, userId, permission)
    }

    const hosts = await this.db.host.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true },
    })
    const visibleHostIds = await this.findHostIdsWithEffectivePermission(hosts.map((host) => host.id), tenantId, userId, permission, role)
    return visibleHostIds.size
  }

  async getEffectiveHostPermissionSet(
    hostId: number,
    tenantId: number,
    userId: number,
    role?: 'ADMIN' | 'USER',
  ): Promise<{ view: boolean; connect: boolean; edit: boolean; admin: boolean }> {
    if (role === 'ADMIN') return { view: true, connect: true, edit: true, admin: true }

    if (this.inventoryAclRepo) {
      const row = (await this.inventoryAclRepo.findEffectiveHostPermissions([hostId], tenantId, userId))[0]
      return {
        view: Boolean(row?.canView),
        connect: Boolean(row?.canConnect),
        edit: Boolean(row?.canEdit),
        admin: Boolean(row?.canAdmin),
      }
    }

    const [view, connect, edit, admin] = await Promise.all([
      this.hasEffectiveHostPermission(hostId, tenantId, userId, 'view', role),
      this.hasEffectiveHostPermission(hostId, tenantId, userId, 'connect', role),
      this.hasEffectiveHostPermission(hostId, tenantId, userId, 'edit', role),
      this.hasEffectiveHostPermission(hostId, tenantId, userId, 'admin', role),
    ])
    return { view, connect, edit, admin }
  }

  async getEffectiveHostPermissionSets(
    hostIds: number[],
    tenantId: number,
    userId: number,
    role?: 'ADMIN' | 'USER',
  ): Promise<Map<number, { view: boolean; connect: boolean; edit: boolean; admin: boolean }>> {
    const uniqueHostIds = [...new Set(hostIds.map((hostId) => Number(hostId)).filter((hostId) => Number.isInteger(hostId) && hostId > 0))]
    if (uniqueHostIds.length === 0) return new Map()

    if (role === 'ADMIN') {
      return new Map(uniqueHostIds.map((hostId) => [
        hostId,
        { view: true, connect: true, edit: true, admin: true },
      ]))
    }

    if (this.inventoryAclRepo) {
      const rows = await this.inventoryAclRepo.findEffectiveHostPermissions(uniqueHostIds, tenantId, userId)
      return new Map(rows.map((row) => [
        Number(row.hostId),
        {
          view: Boolean(row.canView),
          connect: Boolean(row.canConnect),
          edit: Boolean(row.canEdit),
          admin: Boolean(row.canAdmin),
        },
      ]))
    }

    const entries = await Promise.all(uniqueHostIds.map(async (hostId) => [
      hostId,
      await this.getEffectiveHostPermissionSet(hostId, tenantId, userId, role),
    ] as const))
    return new Map(entries)
  }

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
        pemKey: { select: { encryptedKey: true, iv: true, encryptedPassphrase: true, passphraseIv: true } },
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
    const sourceHostBastion = effectiveBastion
      ? await this.findBastionSourceCredentials(effectiveBastion.id, tenantId)
      : null
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
            ip:                sourceHostBastion?.ip ?? effectiveBastion.ip,
            port:              sourceHostBastion?.port ?? effectiveBastion.port,
            sshUser:           sourceHostBastion?.sshUser ?? effectiveBastion.sshUser,
            authType:          sourceHostBastion?.authType ?? effectiveBastion.authType,
            passwordEncrypted: sourceHostBastion ? sourceHostBastion.passwordEncrypted : effectiveBastion.passwordEncrypted,
            pemKey:            sourceHostBastion ? sourceHostBastion.pemKey : registeredBastionPemKey ?? effectiveBastion.pemKey,
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
    const trimmedQuery = query?.trim()
    const candidateLimit = role === 'ADMIN' ? limit : Math.max(limit * 20, 500)
    const hosts = await this.db.host.findMany({
      where: {
        tenantId,
        deletedAt: null,
        AND: [
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
      take: candidateLimit,
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

    const accessibleHosts = await this.filterHostsByConnectPermission(hosts, tenantId, userId, role)

    return accessibleHosts.slice(0, limit).map((host) => ({
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
      },
      select: { id: true },
      take: 20,
    })

    const accessibleHosts = await this.filterHostsByConnectPermission(hosts, tenantId, userId, role)

    const host = accessibleHosts[0]
    if (accessibleHosts.length !== 1 || !host) return null
    if (!await this.hasEffectiveHostPermission(host.id, tenantId, userId, 'connect', role)) return null
    return this.findHostWithCredentials(host.id, tenantId)
  }

  private async filterHostsByConnectPermission<T extends { id: number }>(
    hosts: T[],
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<T[]> {
    if (role === 'ADMIN') return hosts
    if (hosts.length === 0) return []

    if (this.inventoryAclRepo) {
      const rows = await this.inventoryAclRepo.findEffectiveHostPermissions(
        hosts.map((host) => host.id),
        tenantId,
        userId,
      )
      const connectHostIds = new Set(rows
        .filter((row) => Boolean(row.canConnect))
        .map((row) => Number(row.hostId)))
      return hosts.filter((host) => connectHostIds.has(host.id))
    }

    const checked = await Promise.all(hosts.map(async (host) => ({
      host,
      canConnect: await this.hasEffectiveHostPermission(host.id, tenantId, userId, 'connect', role),
    })))
    return checked.filter((item) => item.canConnect).map((item) => item.host)
  }

  private async findBastionSystemPemKey(
    bastionId: number,
  ): Promise<{ encryptedKey: string; iv: string; encryptedPassphrase: string | null; passphraseIv: string | null } | null> {
    const rows = await this.db.$queryRaw<Array<{ encryptedKey: string; iv: string; encryptedPassphrase: string | null; passphraseIv: string | null }>>(
      Prisma.sql`
        SELECT pk.encrypted_key AS encryptedKey, pk.iv,
               pk.encrypted_passphrase AS encryptedPassphrase,
               pk.passphrase_iv AS passphraseIv
        FROM bastion_hosts b
        INNER JOIN pem_keys pk ON pk.id = b.system_pem_key_id
        WHERE b.id = ${bastionId}
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  private async findBastionSourceCredentials(
    bastionId: number,
    tenantId: number,
  ): Promise<{
    ip: string
    port: number
    sshUser: string
    authType: 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
    passwordEncrypted: string | null
    pemKey: { encryptedKey: string; iv: string; encryptedPassphrase: string | null; passphraseIv: string | null } | null
  } | null> {
    const rows = await this.db.$queryRaw<Array<{
      ip: string; port: number; sshUser: string; authType: 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
      passwordEncrypted: string | null; encryptedKey: string | null; iv: string | null
      encryptedPassphrase: string | null; passphraseIv: string | null
    }>>(Prisma.sql`
      SELECT host.ip, host.port, host.ssh_user AS sshUser, host.auth_type AS authType,
             host.password_encrypted AS passwordEncrypted,
             pem.encrypted_key AS encryptedKey, pem.iv,
             pem.encrypted_passphrase AS encryptedPassphrase,
             pem.passphrase_iv AS passphraseIv
      FROM bastion_hosts bastion
      INNER JOIN hosts host ON host.id = bastion.source_host_id
      LEFT JOIN pem_keys pem ON pem.id = host.pem_key_id
      WHERE bastion.id = ${bastionId}
        AND bastion.tenant_id = ${tenantId}
        AND host.tenant_id = ${tenantId}
        AND host.deleted_at IS NULL
      LIMIT 1
    `)
    const row = rows[0]
    if (!row) return null
    return {
      ip: row.ip, port: row.port, sshUser: row.sshUser, authType: row.authType,
      passwordEncrypted: row.passwordEncrypted,
      pemKey: row.encryptedKey && row.iv ? {
        encryptedKey: row.encryptedKey,
        iv: row.iv,
        encryptedPassphrase: row.encryptedPassphrase,
        passphraseIv: row.passphraseIv,
      } : null,
    }
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
    return this.db.session.count({ where: { active: true, user: { tenantId }, host: { tenantId } } })
  }
}
