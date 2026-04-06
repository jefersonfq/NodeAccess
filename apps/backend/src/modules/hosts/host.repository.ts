import { Prisma, type PrismaClient } from '@prisma/client'
import type { TagRepository } from '../tags/tag.repository.js'

export interface HostFilters {
  search?:  string
  scope?:   'PERSONAL' | 'TEAM' | 'GLOBAL'
  groupId?: number
  tagId?:   number
  page?:    number
  limit?:   number
}

const hostInclude = {
  tags: { include: { tag: true } },
} as const

export type HostRow = Prisma.HostGetPayload<{ include: typeof hostInclude }>

export class HostRepository {
  constructor(
    private readonly db:      PrismaClient,
    private readonly tagRepo: TagRepository,
  ) {}

  async findVisible(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    userGroupIds: number[],
    filters: HostFilters,
  ): Promise<{ hosts: HostRow[]; total: number }> {
    const { search, scope, groupId, tagId, page = 1, limit = 200 } = filters
    const skip = (page - 1) * limit

    const visibilityFilter: Prisma.HostWhereInput =
      role === 'ADMIN'
        ? { tenantId }
        : {
            tenantId,
            OR: [
              { scope: 'PERSONAL', ownerId: userId },
              { scope: 'TEAM', groupId: { in: userGroupIds } },
              { scope: 'GLOBAL' },
            ],
          }

    const where: Prisma.HostWhereInput = {
      ...visibilityFilter,
      ...(scope   && { scope }),
      ...(groupId && { groupId }),
      ...(tagId   && { tags: { some: { tagId } } }),
      ...(search  && {
        OR: [
          { name: { contains: search } },
          { ip:   { contains: search } },
        ],
      }),
    }

    const [hosts, total] = await this.db.$transaction([
      this.db.host.findMany({ where, include: hostInclude, skip, take: limit, orderBy: { name: 'asc' } }),
      this.db.host.count({ where }),
    ])

    return { hosts: await this.hydrateConnectionModes(hosts), total }
  }

  async findById(id: number, tenantId: number): Promise<HostRow | null> {
    const host = await this.db.host.findFirst({ where: { id, tenantId }, include: hostInclude })
    if (!host) return null
    return this.hydrateConnectionMode(host)
  }

  async create(data: {
    name:              string
    ip:                string
    port:              number
    sshUser:           string
    authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
    connectionMode:    'DIRECT' | 'AGENT'
    scope:             'PERSONAL' | 'TEAM' | 'GLOBAL'
    tenantId:          number
    ownerId?:          number
    groupId?:          number
    folderId?:         number
    onePasswordRef?:   string
    bastionId?:        number
    pemKeyId?:         number
    passwordEncrypted?: string
    tagNames?:         string[]
  }): Promise<HostRow> {
    const { tagNames, ...hostData } = data

    // Upsert tags first (auto-commit, fora da tx principal)
    const tagIds = tagNames?.length
      ? (await this.tagRepo.upsertByNames(data.tenantId, tagNames)).map((t) => t.id)
      : []

    const hostId = await this.db.$transaction(async (tx) => {
      const { connectionMode, ...prismaHostData } = hostData
      const host = await tx.host.create({ data: prismaHostData })
      await tx.$executeRaw(
        Prisma.sql`UPDATE hosts SET connection_mode = ${connectionMode} WHERE id = ${host.id}`,
      )
      await this.tagRepo.syncHostTags(tx as unknown as PrismaClient, host.id, tagIds)
      return host.id
    })

    const host = await this.db.host.findUniqueOrThrow({ where: { id: hostId }, include: hostInclude })
    return this.hydrateConnectionMode(host)
  }

  async update(
    id: number,
    tenantId: number,
    data: Partial<{
      name:              string
      ip:                string
      port:              number
      sshUser:           string
      authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
      connectionMode:    'DIRECT' | 'AGENT'
      scope:             'PERSONAL' | 'TEAM' | 'GLOBAL'
      groupId:           number | null
      folderId:          number | null
      onePasswordRef:    string | null
      bastionId:         number | null
      pemKeyId:          number | null
      passwordEncrypted: string | null
      tagNames:          string[]
    }>,
  ): Promise<HostRow> {
    const { tagNames, ...hostData } = data

    // Upsert tags first (auto-commit, fora da tx principal)
    let tagIds: number[] | undefined
    if (tagNames !== undefined) {
      tagIds = tagNames.length > 0
        ? (await this.tagRepo.upsertByNames(tenantId, tagNames)).map((t) => t.id)
        : []
    }

    await this.db.$transaction(async (tx) => {
      const { connectionMode, ...prismaHostData } = hostData
      await tx.host.update({ where: { id }, data: prismaHostData })
      if (connectionMode !== undefined) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE hosts SET connection_mode = ${connectionMode} WHERE id = ${id}`,
        )
      }
      if (tagIds !== undefined) {
        await this.tagRepo.syncHostTags(tx as unknown as PrismaClient, id, tagIds)
      }
    })

    // Leitura após commit — enxerga todos os dados consistentes
    const host = await this.db.host.findUniqueOrThrow({ where: { id }, include: hostInclude })
    return this.hydrateConnectionMode(host)
  }

  async trustHostKey(
    id: number,
    tenantId: number,
    fingerprint: string,
    userId: number,
  ): Promise<HostRow> {
    await this.db.host.update({
      where: { id, tenantId },
      data: {
        trustedHostKeyFingerprint: fingerprint,
        trustedHostKeyVerifiedAt: new Date(),
        trustedHostKeyVerifiedBy: userId,
      },
    })

    const host = await this.db.host.findUniqueOrThrow({ where: { id }, include: hostInclude })
    return this.hydrateConnectionMode(host)
  }

  async delete(id: number): Promise<void> {
    await this.db.host.delete({ where: { id } })
  }

  async hasActiveSessions(id: number): Promise<boolean> {
    const count = await this.db.session.count({ where: { hostId: id, active: true } })
    return count > 0
  }

  private async hydrateConnectionModes(hosts: HostRow[]): Promise<HostRow[]> {
    if (hosts.length === 0) return hosts

    const rows = await this.db.$queryRaw<Array<{ id: number; connectionMode: 'DIRECT' | 'AGENT' }>>(Prisma.sql`
      SELECT id, connection_mode AS connectionMode
      FROM hosts
      WHERE id IN (${Prisma.join(hosts.map((host) => host.id))})
    `)

    const modeById = new Map(rows.map((row) => [row.id, row.connectionMode]))
    return hosts.map((host) => Object.assign(host, { connectionMode: modeById.get(host.id) ?? 'DIRECT' }) as HostRow)
  }

  private async hydrateConnectionMode(host: HostRow): Promise<HostRow> {
    const rows = await this.db.$queryRaw<Array<{ connectionMode: 'DIRECT' | 'AGENT' }>>(Prisma.sql`
      SELECT connection_mode AS connectionMode
      FROM hosts
      WHERE id = ${host.id}
      LIMIT 1
    `)

    return Object.assign(host, { connectionMode: rows[0]?.connectionMode ?? 'DIRECT' }) as HostRow
  }
}
