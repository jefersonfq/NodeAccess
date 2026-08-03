import { Prisma, type PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import type { WebhookService } from '../webhooks/webhook.service.js'
import type { SshRepository } from '../ssh/ssh.repository.js'

type UserRole = 'admin' | 'user'
type VisibleHost = {
  id: number
  tenantId: number
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
    private readonly webhookService: WebhookService,
    private readonly sshRepo: SshRepository,
  ) {}

  async list(hostId: number, tenantId: number, userId: number, role: UserRole): Promise<PortForwardingDto[]> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')

    const host = await this.findHostWithPermission(hostId, tenantId, userId, role, 'view')
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
    assertCanManageForwardings(role)

    const host = await this.findHostWithPermission(hostId, tenantId, userId, role, 'edit')
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

    const result = await this.fetchById(created.id)
    void this.webhookService.publishEvent({
      tenantId:     tenantId,
      eventType:    'port_forwarding.created',
      eventVersion: 1,
      resourceType: 'port_forwarding',
      resourceId:   String(result.id),
      occurredAt:   new Date(),
      data: {
        forwardingId: result.id,
        hostId:       hostId,
        userId:       userId,
        localPort:    result.localPort,
        remoteHost:   result.remoteHost,
        remotePort:   result.remotePort,
        description:  result.description ?? null,
      },
    }).catch(() => {})
    return result
  }

  async update(
    id: number,
    tenantId: number,
    userId: number,
    role: UserRole,
    data: Partial<{ description: string | null; bindAddress: string; webEnabled: boolean; webProtocol: string; localPort: number; remoteHost: string; remotePort: number; autoStart: boolean }>,
  ): Promise<PortForwardingDto> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')
    assertCanManageForwardings(role)

    const existing = await this.db.portForwarding.findFirst({
      where: { id },
      include: { host: { select: { id: true, tenantId: true } } },
    })
    if (!existing || !await this.canAccessHost(existing.host, tenantId, userId, role, 'edit')) {
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

    const rows = await this.db.$queryRaw<PortForwardingWithHostDto[]>(Prisma.sql`
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
      WHERE h.tenant_id = ${tenantId}
        AND h.deleted_at IS NULL
      ORDER BY pf.host_id ASC, pf.created_at ASC
    `)
    if (role === 'admin') return rows
    const visibleHostIds = await this.sshRepo.findHostIdsWithEffectivePermission(
      rows.map((row) => row.hostId),
      tenantId,
      userId,
      'view',
      'USER',
    )
    return rows.filter((row) => visibleHostIds.has(row.hostId))
  }

  async remove(id: number, tenantId: number, userId: number, role: UserRole): Promise<void> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')
    assertCanManageForwardings(role)

    const existing = await this.db.portForwarding.findFirst({
      where: { id },
      include: { host: { select: { id: true, tenantId: true } } },
    })
    if (!existing || !await this.canAccessHost(existing.host, tenantId, userId, role, 'edit')) {
      throw new AppError('Configuração não encontrada', 404, 'FORWARDING_NOT_FOUND')
    }
    await this.db.portForwarding.delete({ where: { id } })
    void this.webhookService.publishEvent({
      tenantId:     tenantId,
      eventType:    'port_forwarding.deleted',
      eventVersion: 1,
      resourceType: 'port_forwarding',
      resourceId:   String(id),
      occurredAt:   new Date(),
      data: {
        forwardingId: id,
        hostId:       existing.host.id,
        userId:       userId,
        localPort:    existing.localPort,
        remoteHost:   existing.remoteHost,
        remotePort:   existing.remotePort,
        description:  existing.description ?? null,
      },
    }).catch(() => {})
  }

  async getWebTarget(id: number, tenantId: number, userId: number, role: UserRole): Promise<PortForwardingWebTargetDto> {
    await this.entitlements.requireFeature(tenantId, 'portForwarding', 'Acessos locais não licenciados para este tenant')

    const existing = await this.db.portForwarding.findFirst({
      where: { id },
      include: { host: { select: { id: true, tenantId: true } } },
    })
    if (!existing || !await this.canAccessHost(existing.host, tenantId, userId, role, 'connect')) {
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

  private async findHostWithPermission(
    hostId: number,
    tenantId: number,
    userId: number,
    role: UserRole,
    permission: 'view' | 'connect' | 'edit',
  ): Promise<VisibleHost | null> {
    const host = await this.db.host.findFirst({
      where: { id: hostId, tenantId, deletedAt: null },
      select: { id: true, tenantId: true },
    })
    if (!host) return null

    return await this.canAccessHost(host, tenantId, userId, role, permission) ? host : null
  }

  private async canAccessHost(
    host: VisibleHost,
    tenantId: number,
    userId: number,
    role: UserRole,
    permission: 'view' | 'connect' | 'edit',
  ): Promise<boolean> {
    if (host.tenantId !== tenantId) return false
    const normalizedRole = role === 'admin' ? 'ADMIN' : 'USER'
    return this.sshRepo.hasEffectiveHostPermission(host.id, tenantId, userId, permission, normalizedRole)
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

function assertCanManageForwardings(role: UserRole): void {
  if (role === 'admin') return
  throw new AppError('Sem permissão para gerenciar acessos locais', 403, 'FORWARDING_MANAGE_FORBIDDEN')
}
