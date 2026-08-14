import { Prisma, type PrismaClient, type BastionHost } from '@prisma/client'

export interface BastionSourceHostRow {
  id: number
  tenantId: number
  name: string
  ip: string
  port: number
  sshUser: string
  authType: 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
  accessProtocol: string
  connectionMode: string
  pemKeyId: number | null
  passwordEncrypted: string | null
  onePasswordRef: string | null
  bastionId: number | null
  groupBastionId: number | null
}

export type BastionHostRow = BastionHost & {
  systemPemKeyId: number | null
  sourceHostId: number | null
  tenantId: number
  sourceHost: BastionSourceHostRow | null
}

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

  async findAll(tenantId: number): Promise<BastionHostRow[]> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`
        SELECT id
        FROM bastion_hosts
        WHERE tenant_id = ${tenantId}
        ORDER BY name ASC
      `,
    )
    if (rows.length === 0) return []
    const bastions = await this.db.bastionHost.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      orderBy: { name: 'asc' },
    })
    return this.hydrateSystemPemKeyIds(bastions)
  }

  async findById(id: number, tenantId: number): Promise<BastionHostRow | null> {
    const bastion = await this.db.bastionHost.findUnique({ where: { id } })
    if (!bastion) return null
    const row = await this.hydrateSystemPemKeyId(bastion)
    return row.tenantId === tenantId ? row : null
  }

  async create(data: {
    name:              string
    ip:                string
    port:              number
    sshUser:           string
    authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
    tenantId:          number
    sourceHostId?:     number
    pemKeyId?:         number
    systemPemKeyId?:   number
    passwordEncrypted?: string
  }): Promise<BastionHostRow> {
    const { systemPemKeyId } = data
    const [inserted] = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO bastion_hosts
            (name, ip, port, ssh_user, auth_type, tenant_id, source_host_id, pem_key_id, password_encrypted, created_at, updated_at)
          VALUES
            (${data.name}, ${data.ip}, ${data.port}, ${data.sshUser}, ${data.authType}, ${data.tenantId}, ${data.sourceHostId ?? null}, ${data.pemKeyId ?? null}, ${data.passwordEncrypted ?? null}, NOW(3), NOW(3))
        `,
      )
      return tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`SELECT LAST_INSERT_ID() AS id`)
    })
    if (!inserted) throw new Error('Failed to create bastion')
    const bastion = await this.db.bastionHost.findUniqueOrThrow({ where: { id: inserted.id } })
    if (systemPemKeyId !== undefined) {
      await this.setSystemPemKeyId(bastion.id, systemPemKeyId)
    }
    return this.findByIdOrThrow(bastion.id, data.tenantId)
  }

  async update(
    id: number,
    data: {
      name?:              string
      ip?:                string
      port?:              number
      sshUser?:           string
      authType?:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
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

  async systemPemKeyExists(id: number, tenantId: number): Promise<boolean> {
    const count = await this.db.pemKey.count({ where: { id, createdBy: { tenantId } } })
    return count > 0
  }

  async findSourceHost(id: number, tenantId: number): Promise<BastionSourceHostRow | null> {
    const host = await this.db.host.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true, tenantId: true, name: true, ip: true, port: true, sshUser: true,
        authType: true, accessProtocol: true, connectionMode: true, pemKeyId: true,
        passwordEncrypted: true, onePasswordRef: true, bastionId: true,
        group: { select: { bastionId: true } },
      },
    })
    if (!host) return null
    return { ...host, groupBastionId: host.group?.bastionId ?? null }
  }

  async findBySourceHostId(sourceHostId: number, tenantId: number): Promise<BastionHostRow | null> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT id FROM bastion_hosts
      WHERE source_host_id = ${sourceHostId} AND tenant_id = ${tenantId}
      LIMIT 1
    `)
    return rows[0] ? this.findById(rows[0].id, tenantId) : null
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
    const rows = await this.db.$queryRaw<Array<{ id: number; systemPemKeyId: number | null; sourceHostId: number | null; tenantId: number }>>(
      Prisma.sql`
        SELECT id, system_pem_key_id AS systemPemKeyId, source_host_id AS sourceHostId, tenant_id AS tenantId
        FROM bastion_hosts
        WHERE id IN (${Prisma.join(bastions.map((bastion) => bastion.id))})
      `,
    )
    const byId = new Map(rows.map((row) => [row.id, row]))
    return Promise.all(bastions.map(async (bastion) => {
      const metadata = byId.get(bastion.id)
      const sourceHost = metadata?.sourceHostId
        ? await this.findSourceHost(metadata.sourceHostId, metadata.tenantId)
        : null
      return {
        ...bastion,
        ...(sourceHost ? {
          name: sourceHost.name,
          ip: sourceHost.ip,
          port: sourceHost.port,
          sshUser: sourceHost.sshUser,
          authType: sourceHost.authType,
          passwordEncrypted: sourceHost.passwordEncrypted,
        } : {}),
        systemPemKeyId: sourceHost?.pemKeyId ?? metadata?.systemPemKeyId ?? null,
        sourceHostId: metadata?.sourceHostId ?? null,
        tenantId: metadata?.tenantId ?? 0,
        sourceHost,
      }
    }))
  }

  private async hydrateSystemPemKeyId(bastion: BastionHost): Promise<BastionHostRow> {
    const rows = await this.db.$queryRaw<Array<{ systemPemKeyId: number | null; sourceHostId: number | null; tenantId: number }>>(
      Prisma.sql`
        SELECT system_pem_key_id AS systemPemKeyId, source_host_id AS sourceHostId, tenant_id AS tenantId
        FROM bastion_hosts
        WHERE id = ${bastion.id}
        LIMIT 1
      `,
    )
    const metadata = rows[0]
    const sourceHost = metadata?.sourceHostId
      ? await this.findSourceHost(metadata.sourceHostId, metadata.tenantId)
      : null
    return {
      ...bastion,
      ...(sourceHost ? {
        name: sourceHost.name, ip: sourceHost.ip, port: sourceHost.port,
        sshUser: sourceHost.sshUser, authType: sourceHost.authType,
        passwordEncrypted: sourceHost.passwordEncrypted,
      } : {}),
      systemPemKeyId: sourceHost?.pemKeyId ?? metadata?.systemPemKeyId ?? null,
      sourceHostId: metadata?.sourceHostId ?? null,
      tenantId: metadata?.tenantId ?? 0,
      sourceHost,
    }
  }

  private async findByIdOrThrow(id: number, tenantId?: number): Promise<BastionHostRow> {
    const bastion = tenantId !== undefined
      ? await this.findById(id, tenantId)
      : await this.hydrateSystemPemKeyId(await this.db.bastionHost.findUniqueOrThrow({ where: { id } }))
    if (!bastion) throw new Error('Failed to load bastion after write')
    return bastion
  }

  async isUsedByGroupOrHost(id: number, tenantId: number): Promise<boolean> {
    const [groups, hosts] = await Promise.all([
      this.db.group.count({ where: { bastionId: id, tenantId } }),
      this.db.host.count({ where: { bastionId: id, tenantId, deletedAt: null } }),
    ])
    return groups > 0 || hosts > 0
  }

  async findUsageSummaries(ids: number[], tenantId: number): Promise<Map<number, BastionUsageSummary>> {
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
        where:   { bastionId: { in: ids }, tenantId, deletedAt: null },
        select:  { name: true, bastionId: true },
        orderBy: { name: 'asc' },
      }),
      this.db.group.findMany({
        where:   { bastionId: { in: ids }, tenantId },
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
