import { Prisma, type PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'

type UserRole = 'admin' | 'user'
type VisibleHost = {
  id: number
  tenantId: number
  scope: 'PERSONAL' | 'TEAM' | 'GLOBAL'
  ownerId: number | null
  groupId: number | null
}

export interface PortForwardingDto {
  id:          number
  hostId:      number
  description: string | null
  bindAddress: string
  webEnabled:  boolean
  webProtocol: 'http' | 'https'
  localPort:   number
  remoteHost:  string
  remotePort:  number
  autoStart:   boolean
  createdAt:   Date
}

export interface PortForwardingWithHostDto extends PortForwardingDto {
  hostName:        string
  hostIp:          string
  hostConnectionMode: 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO'
}

export interface PortForwardingWebTargetDto extends PortForwardingDto {
  hostName: string
  hostIp: string
}

export class PortForwardingService {
  constructor(
    private readonly db: PrismaClient,
    private readonly entitlements: LicenseEntitlementService,
  ) {}

  async list(hostId: number, tenantId: number, userId: number, role: UserRole): Promise<PortForwardingDto[]> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')

    const host = await this.findVisibleHost(hostId, tenantId, userId, role)
    if (!host) throw new AppError('Host não encontrado', 404, 'HOST_NOT_FOUND')

    return this.fetchByHostId(hostId)
  }

  async create(
    hostId: number,
    tenantId: number,
    userId: number,
    role: UserRole,
    data: { description?: string; bindAddress?: string; webEnabled?: boolean; webProtocol?: string; localPort: number; remoteHost: string; remotePort: number; autoStart?: boolean },
  ): Promise<PortForwardingDto> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')

    const host = await this.findVisibleHost(hostId, tenantId, userId, role)
    if (!host) throw new AppError('Host não encontrado', 404, 'HOST_NOT_FOUND')

    const created = await this.db.portForwarding.create({
      data: {
        hostId,
        description: data.description ?? null,
        localPort:   data.localPort,
        remoteHost:  data.remoteHost,
        remotePort:  data.remotePort,
        autoStart:   data.autoStart ?? false,
      },
    })

    await this.db.$executeRaw(
      Prisma.sql`
        UPDATE port_forwardings
        SET
          bind_address = ${normalizeBindAddress(data.bindAddress)},
          web_enabled = ${data.webEnabled ?? false},
          web_protocol = ${normalizeWebProtocol(data.webProtocol)}
        WHERE id = ${created.id}
      `,
    )

    return this.fetchById(created.id)
  }

  async update(
    id: number,
    tenantId: number,
    userId: number,
    role: UserRole,
    data: Partial<{ description: string | null; bindAddress: string; webEnabled: boolean; webProtocol: string; localPort: number; remoteHost: string; remotePort: number; autoStart: boolean }>,
  ): Promise<PortForwardingDto> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')

    const existing = await this.db.portForwarding.findFirst({
      where: { id },
      include: { host: { select: { id: true, tenantId: true, scope: true, ownerId: true, groupId: true } } },
    })
    if (!existing || !this.canAccessHost(existing.host, tenantId, userId, role, await this.getUserGroupIds(userId))) {
      throw new AppError('Configuração não encontrada', 404, 'FORWARDING_NOT_FOUND')
    }
    const current = await this.fetchById(id)
    await this.db.portForwarding.update({
      where: { id },
      data: {
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.localPort !== undefined ? { localPort: data.localPort } : {}),
        ...(data.remoteHost !== undefined ? { remoteHost: data.remoteHost } : {}),
        ...(data.remotePort !== undefined ? { remotePort: data.remotePort } : {}),
        ...(data.autoStart !== undefined ? { autoStart: data.autoStart } : {}),
      },
    })

    if (data.bindAddress !== undefined || data.webEnabled !== undefined || data.webProtocol !== undefined) {
      await this.db.$executeRaw(
        Prisma.sql`
          UPDATE port_forwardings
          SET
            bind_address = ${data.bindAddress !== undefined ? normalizeBindAddress(data.bindAddress) : current.bindAddress},
            web_enabled = ${data.webEnabled ?? current.webEnabled},
            web_protocol = ${normalizeWebProtocol(data.webProtocol ?? current.webProtocol)}
          WHERE id = ${id}
        `,
      )
    }

    return this.fetchById(id)
  }

  async listAll(tenantId: number, userId: number, role: UserRole): Promise<PortForwardingWithHostDto[]> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')

    const userGroupIds = role === 'admin' ? [] : await this.getUserGroupIds(userId)
    const visibilitySql = role === 'admin'
      ? Prisma.sql`h.tenant_id = ${tenantId}`
      : Prisma.sql`
          h.tenant_id = ${tenantId}
          AND (
            h.scope = 'GLOBAL'
            OR (h.scope = 'PERSONAL' AND h.owner_id = ${userId})
            OR (h.scope = 'TEAM' AND h.group_id IN (${Prisma.join(userGroupIds.length ? userGroupIds : [-1])}))
          )
        `

    return this.db.$queryRaw<PortForwardingWithHostDto[]>(Prisma.sql`
      SELECT
        pf.id,
        pf.host_id AS hostId,
        pf.description,
        pf.bind_address AS bindAddress,
        pf.web_enabled AS webEnabled,
        pf.web_protocol AS webProtocol,
        pf.local_port AS localPort,
        pf.remote_host AS remoteHost,
        pf.remote_port AS remotePort,
        pf.auto_start AS autoStart,
        pf.created_at AS createdAt,
        h.name AS hostName,
        h.ip AS hostIp,
        h.connection_mode AS hostConnectionMode
      FROM port_forwardings pf
      INNER JOIN hosts h ON h.id = pf.host_id
      WHERE ${visibilitySql}
      ORDER BY pf.host_id ASC, pf.created_at ASC
    `)
  }

  async remove(id: number, tenantId: number, userId: number, role: UserRole): Promise<void> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')

    const existing = await this.db.portForwarding.findFirst({
      where: { id },
      include: { host: { select: { id: true, tenantId: true, scope: true, ownerId: true, groupId: true } } },
    })
    if (!existing || !this.canAccessHost(existing.host, tenantId, userId, role, await this.getUserGroupIds(userId))) {
      throw new AppError('Configuração não encontrada', 404, 'FORWARDING_NOT_FOUND')
    }
    await this.db.portForwarding.delete({ where: { id } })
  }

  async getWebTarget(id: number, tenantId: number, userId: number, role: UserRole): Promise<PortForwardingWebTargetDto> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')

    const existing = await this.db.portForwarding.findFirst({
      where: { id },
      include: { host: { select: { id: true, tenantId: true, scope: true, ownerId: true, groupId: true } } },
    })
    if (!existing || !this.canAccessHost(existing.host, tenantId, userId, role, await this.getUserGroupIds(userId))) {
      throw new AppError('Configuração não encontrada', 404, 'FORWARDING_NOT_FOUND')
    }

    const rows = await this.db.$queryRaw<PortForwardingWebTargetDto[]>(Prisma.sql`
      SELECT
        pf.id,
        pf.host_id AS hostId,
        pf.description,
        pf.bind_address AS bindAddress,
        pf.web_enabled AS webEnabled,
        pf.web_protocol AS webProtocol,
        pf.local_port AS localPort,
        pf.remote_host AS remoteHost,
        pf.remote_port AS remotePort,
        pf.auto_start AS autoStart,
        pf.created_at AS createdAt,
        h.name AS hostName,
        h.ip AS hostIp
      FROM port_forwardings pf
      INNER JOIN hosts h ON h.id = pf.host_id
      WHERE pf.id = ${id}
      LIMIT 1
    `)

    if (!rows[0]) throw new AppError('Configuração não encontrada', 404, 'FORWARDING_NOT_FOUND')
    return rows[0]
  }

  private async findVisibleHost(hostId: number, tenantId: number, userId: number, role: UserRole): Promise<VisibleHost | null> {
    const host = await this.db.host.findFirst({
      where: { id: hostId, tenantId },
      select: { id: true, tenantId: true, scope: true, ownerId: true, groupId: true },
    })
    if (!host) return null

    const userGroupIds = role === 'admin' ? [] : await this.getUserGroupIds(userId)
    return this.canAccessHost(host, tenantId, userId, role, userGroupIds) ? host : null
  }

  private canAccessHost(host: VisibleHost, tenantId: number, userId: number, role: UserRole, userGroupIds: number[]): boolean {
    if (host.tenantId !== tenantId) return false
    if (role === 'admin') return true
    if (host.scope === 'GLOBAL') return true
    if (host.scope === 'PERSONAL' && host.ownerId === userId) return true
    if (host.scope === 'TEAM' && host.groupId !== null && userGroupIds.includes(host.groupId)) return true
    return false
  }

  private async getUserGroupIds(userId: number): Promise<number[]> {
    const rows = await this.db.userGroup.findMany({
      where: { userId },
      select: { groupId: true },
    })
    return rows.map((row) => row.groupId)
  }

  private async fetchById(id: number): Promise<PortForwardingDto> {
    const rows = await this.db.$queryRaw<PortForwardingDto[]>(Prisma.sql`
      SELECT
        id,
        host_id AS hostId,
        description,
        bind_address AS bindAddress,
        web_enabled AS webEnabled,
        web_protocol AS webProtocol,
        local_port AS localPort,
        remote_host AS remoteHost,
        remote_port AS remotePort,
        auto_start AS autoStart,
        created_at AS createdAt
      FROM port_forwardings
      WHERE id = ${id}
      LIMIT 1
    `)

    if (!rows[0]) throw new AppError('Configuração não encontrada', 404, 'FORWARDING_NOT_FOUND')
    return rows[0]
  }

  private fetchByHostId(hostId: number): Promise<PortForwardingDto[]> {
    return this.db.$queryRaw<PortForwardingDto[]>(Prisma.sql`
      SELECT
        id,
        host_id AS hostId,
        description,
        bind_address AS bindAddress,
        web_enabled AS webEnabled,
        web_protocol AS webProtocol,
        local_port AS localPort,
        remote_host AS remoteHost,
        remote_port AS remotePort,
        auto_start AS autoStart,
        created_at AS createdAt
      FROM port_forwardings
      WHERE host_id = ${hostId}
      ORDER BY created_at ASC
    `)
  }
}

function normalizeBindAddress(bindAddress?: string): string {
  if (bindAddress === undefined || bindAddress === '127.0.0.1') return '127.0.0.1'
  if (bindAddress === '0.0.0.0') return '0.0.0.0'
  throw new AppError('Bind address inválido', 422, 'INVALID_BIND_ADDRESS')
}

function normalizeWebProtocol(webProtocol?: string): 'http' | 'https' {
  if (webProtocol === undefined || webProtocol === 'http') return 'http'
  if (webProtocol === 'https') return 'https'
  throw new AppError('Protocolo web inválido', 422, 'INVALID_WEB_PROTOCOL')
}
