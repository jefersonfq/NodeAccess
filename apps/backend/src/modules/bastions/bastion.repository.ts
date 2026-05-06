import { Prisma, type PrismaClient, type BastionHost } from '@prisma/client'

export type BastionHostRow = BastionHost & { systemPemKeyId: number | null }

export interface BastionUsageSummary {
  directHostCount:    number
  inheritedHostCount: number
  groupCount:         number
  directHostNames:    string[]
  inheritedHostNames: string[]
  groupNames:         string[]
}

export class BastionRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(): Promise<BastionHostRow[]> {
    const bastions = await this.db.bastionHost.findMany({ orderBy: { name: 'asc' } })
    return this.hydrateSystemPemKeyIds(bastions)
  }

  async findById(id: number): Promise<BastionHostRow | null> {
    const bastion = await this.db.bastionHost.findUnique({ where: { id } })
    if (!bastion) return null
    return this.hydrateSystemPemKeyId(bastion)
  }

  async create(data: {
    name:              string
    ip:                string
    port:              number
    sshUser:           string
    authType:          'PEM' | 'PASSWORD'
    pemKeyId?:         number
    systemPemKeyId?:   number
    passwordEncrypted?: string
  }): Promise<BastionHostRow> {
    const { systemPemKeyId, ...bastionData } = data
    const bastion = await this.db.bastionHost.create({ data: bastionData })
    if (systemPemKeyId !== undefined) {
      await this.setSystemPemKeyId(bastion.id, systemPemKeyId)
    }
    return this.findByIdOrThrow(bastion.id)
  }

  async update(
    id: number,
    data: {
      name?:              string
      ip?:                string
      port?:              number
      sshUser?:           string
      authType?:          'PEM' | 'PASSWORD'
      pemKeyId?:          number | null
      systemPemKeyId?:    number | null
      passwordEncrypted?: string | null
    },
  ): Promise<BastionHostRow> {
    const { systemPemKeyId, ...bastionData } = data
    await this.db.bastionHost.update({ where: { id }, data: bastionData })
    if (systemPemKeyId !== undefined) {
      await this.setSystemPemKeyId(id, systemPemKeyId)
    }
    return this.findByIdOrThrow(id)
  }

  async delete(id: number): Promise<void> {
    await this.db.bastionHost.delete({ where: { id } })
  }

  async createPemKey(data: { name: string; encryptedKey: string; iv: string }): Promise<number> {
    const key = await this.db.bastionPemKey.create({ data })
    return key.id
  }

  async deletePemKey(id: number): Promise<void> {
    await this.db.bastionPemKey.delete({ where: { id } })
  }

  async systemPemKeyExists(id: number): Promise<boolean> {
    const count = await this.db.pemKey.count({ where: { id } })
    return count > 0
  }

  private async setSystemPemKeyId(id: number, systemPemKeyId: number | null): Promise<void> {
    await this.db.$executeRaw(
      Prisma.sql`
        UPDATE bastion_hosts
        SET system_pem_key_id = ${systemPemKeyId}
        WHERE id = ${id}
      `,
    )
  }

  private async hydrateSystemPemKeyIds(bastions: BastionHost[]): Promise<BastionHostRow[]> {
    if (bastions.length === 0) return []
    const rows = await this.db.$queryRaw<Array<{ id: number; systemPemKeyId: number | null }>>(
      Prisma.sql`
        SELECT id, system_pem_key_id AS systemPemKeyId
        FROM bastion_hosts
        WHERE id IN (${Prisma.join(bastions.map((bastion) => bastion.id))})
      `,
    )
    const byId = new Map(rows.map((row) => [row.id, row.systemPemKeyId]))
    return bastions.map((bastion) => ({
      ...bastion,
      systemPemKeyId: byId.get(bastion.id) ?? null,
    }))
  }

  private async hydrateSystemPemKeyId(bastion: BastionHost): Promise<BastionHostRow> {
    const rows = await this.db.$queryRaw<Array<{ systemPemKeyId: number | null }>>(
      Prisma.sql`
        SELECT system_pem_key_id AS systemPemKeyId
        FROM bastion_hosts
        WHERE id = ${bastion.id}
        LIMIT 1
      `,
    )
    return {
      ...bastion,
      systemPemKeyId: rows[0]?.systemPemKeyId ?? null,
    }
  }

  private async findByIdOrThrow(id: number): Promise<BastionHostRow> {
    const bastion = await this.findById(id)
    if (!bastion) throw new Error('Failed to load bastion after write')
    return bastion
  }

  async isUsedByGroupOrHost(id: number): Promise<boolean> {
    const [groups, hosts] = await Promise.all([
      this.db.group.count({ where: { bastionId: id } }),
      this.db.host.count({ where: { bastionId: id, deletedAt: null } }),
    ])
    return groups > 0 || hosts > 0
  }

  async findUsageSummaries(ids: number[]): Promise<Map<number, BastionUsageSummary>> {
    const summaries = new Map<number, BastionUsageSummary>()
    for (const id of ids) {
      summaries.set(id, {
        directHostCount:    0,
        inheritedHostCount: 0,
        groupCount:         0,
        directHostNames:    [],
        inheritedHostNames: [],
        groupNames:         [],
      })
    }
    if (ids.length === 0) return summaries

    const [directHosts, groups] = await Promise.all([
      this.db.host.findMany({
        where:   { bastionId: { in: ids }, deletedAt: null },
        select:  { name: true, bastionId: true },
        orderBy: { name: 'asc' },
      }),
      this.db.group.findMany({
        where:   { bastionId: { in: ids } },
        select:  {
          name:      true,
          bastionId: true,
          hosts:     {
            where:   { bastionId: null, deletedAt: null },
            select:  { name: true },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ])

    for (const host of directHosts) {
      if (!host.bastionId) continue
      const summary = summaries.get(host.bastionId)
      if (!summary) continue
      summary.directHostCount += 1
      summary.directHostNames.push(host.name)
    }

    for (const group of groups) {
      if (!group.bastionId) continue
      const summary = summaries.get(group.bastionId)
      if (!summary) continue
      summary.groupCount += 1
      summary.groupNames.push(group.name)
      summary.inheritedHostCount += group.hosts.length
      summary.inheritedHostNames.push(...group.hosts.map((host) => host.name))
    }

    return summaries
  }
}
