import { Prisma, type PrismaClient } from '@prisma/client'

export type SecretScope  = 'PERSONAL' | 'GROUP' | 'TENANT'
export type SecretSource = 'MANUAL' | 'HOST_CONNECTION'

export interface SecretRow {
  id: number
  tenantId: number
  alias: string
  description: string | null
  scope: SecretScope
  ownerUserId: number | null
  groupId: number | null
  createdByUserId: number | null
  createdByUsername: string | null
  source: SecretSource
  encryptedValue: string
  iv: string
  createdAt: Date
  updatedAt: Date
  rotatedAt: Date | null
  revokedAt: Date | null
}

export interface CreateSecretRowInput {
  tenantId: number
  alias: string
  description?: string
  scope: SecretScope
  ownerUserId?: number
  groupId?: number
  createdByUserId?: number
  source?: SecretSource
  encryptedValue: string
  iv: string
}

export interface UpdateSecretMetadataInput {
  alias?: string
  description?: string | null
  scope?: SecretScope
  ownerUserId?: number | null
  groupId?: number | null
}

function mapRow(row: {
  id: number
  tenantId: number
  alias: string
  description: string | null
  scope: SecretScope
  ownerUserId: number | null
  groupId: number | null
  createdByUserId: number | null
  createdByUsername: string | null
  source: SecretSource
  encryptedValue: string
  iv: string
  createdAt: Date
  updatedAt: Date
  rotatedAt: Date | null
  revokedAt: Date | null
}): SecretRow {
  return row
}

export class SecretRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAccessible(params: {
    tenantId: number
    userId: number
    groupIds: number[]
    isAdmin: boolean
    includeRevoked?: boolean
  }): Promise<SecretRow[]> {
    const rows = await this.db.$queryRaw<SecretRow[]>(Prisma.sql`
      SELECT
        s.id,
        s.tenant_id AS tenantId,
        s.alias,
        s.description,
        s.scope,
        s.owner_user_id AS ownerUserId,
        s.group_id AS groupId,
        s.created_by_user_id AS createdByUserId,
        u.name AS createdByUsername,
        s.source,
        s.encrypted_value AS encryptedValue,
        s.iv,
        s.created_at AS createdAt,
        s.updated_at AS updatedAt,
        s.rotated_at AS rotatedAt,
        s.revoked_at AS revokedAt
      FROM secrets s
      LEFT JOIN users u ON u.id = s.created_by_user_id
      WHERE s.tenant_id = ${params.tenantId}
        ${params.includeRevoked ? Prisma.empty : Prisma.sql`AND s.revoked_at IS NULL`}
        AND (
          ${params.isAdmin}
          OR s.owner_user_id = ${params.userId}
          OR s.scope = ${'TENANT'}
          OR ${params.groupIds.length > 0 ? Prisma.sql`s.group_id IN (${Prisma.join(params.groupIds)})` : Prisma.sql`FALSE`}
        )
      ORDER BY s.revoked_at IS NULL DESC, s.scope ASC, s.alias ASC
    `)

    return rows.map(mapRow)
  }

  async findById(tenantId: number, id: number): Promise<SecretRow | null> {
    const rows = await this.db.$queryRaw<SecretRow[]>(Prisma.sql`
      SELECT
        s.id,
        s.tenant_id AS tenantId,
        s.alias,
        s.description,
        s.scope,
        s.owner_user_id AS ownerUserId,
        s.group_id AS groupId,
        s.created_by_user_id AS createdByUserId,
        u.name AS createdByUsername,
        s.source,
        s.encrypted_value AS encryptedValue,
        s.iv,
        s.created_at AS createdAt,
        s.updated_at AS updatedAt,
        s.rotated_at AS rotatedAt,
        s.revoked_at AS revokedAt
      FROM secrets s
      LEFT JOIN users u ON u.id = s.created_by_user_id
      WHERE s.tenant_id = ${tenantId} AND s.id = ${id}
      LIMIT 1
    `)

    return rows[0] ? mapRow(rows[0]) : null
  }

  async findAccessibleByAliases(params: {
    tenantId: number
    userId: number
    groupIds: number[]
    isAdmin: boolean
    aliases: string[]
  }): Promise<SecretRow[]> {
    if (params.aliases.length === 0) return []

    const rows = await this.db.$queryRaw<SecretRow[]>(Prisma.sql`
      SELECT
        s.id,
        s.tenant_id AS tenantId,
        s.alias,
        s.description,
        s.scope,
        s.owner_user_id AS ownerUserId,
        s.group_id AS groupId,
        s.created_by_user_id AS createdByUserId,
        u.name AS createdByUsername,
        s.source,
        s.encrypted_value AS encryptedValue,
        s.iv,
        s.created_at AS createdAt,
        s.updated_at AS updatedAt,
        s.rotated_at AS rotatedAt,
        s.revoked_at AS revokedAt
      FROM secrets s
      LEFT JOIN users u ON u.id = s.created_by_user_id
      WHERE s.tenant_id = ${params.tenantId}
        AND s.revoked_at IS NULL
        AND s.alias IN (${Prisma.join(params.aliases)})
        AND (
          ${params.isAdmin}
          OR s.owner_user_id = ${params.userId}
          OR s.scope = ${'TENANT'}
          OR ${params.groupIds.length > 0 ? Prisma.sql`s.group_id IN (${Prisma.join(params.groupIds)})` : Prisma.sql`FALSE`}
        )
    `)

    return rows.map(mapRow)
  }

  async create(input: CreateSecretRowInput): Promise<SecretRow> {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO secrets (
        tenant_id,
        alias,
        description,
        scope,
        owner_user_id,
        group_id,
        created_by_user_id,
        source,
        encrypted_value,
        iv,
        updated_at
      ) VALUES (
        ${input.tenantId},
        ${input.alias},
        ${input.description ?? null},
        ${input.scope},
        ${input.ownerUserId ?? null},
        ${input.groupId ?? null},
        ${input.createdByUserId ?? null},
        ${input.source ?? 'MANUAL'},
        ${input.encryptedValue},
        ${input.iv},
        NOW(3)
      )
    `)

    const inserted = await this.findByAlias(input.tenantId, input.alias)
    if (!inserted) throw new Error('Secret insert failed')
    return inserted
  }

  async updateMetadata(tenantId: number, id: number, input: UpdateSecretMetadataInput): Promise<SecretRow> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE secrets
      SET
        alias = COALESCE(${input.alias ?? null}, alias),
        description = ${input.description === undefined ? Prisma.sql`description` : input.description},
        scope = COALESCE(${input.scope ?? null}, scope),
        owner_user_id = ${input.ownerUserId === undefined ? Prisma.sql`owner_user_id` : input.ownerUserId},
        group_id = ${input.groupId === undefined ? Prisma.sql`group_id` : input.groupId},
        updated_at = NOW(3)
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `)

    const updated = await this.findById(tenantId, id)
    if (!updated) throw new Error('Secret update failed')
    return updated
  }

  async rotate(tenantId: number, id: number, encryptedValue: string, iv: string): Promise<SecretRow> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE secrets
      SET
        encrypted_value = ${encryptedValue},
        iv = ${iv},
        rotated_at = NOW(3),
        updated_at = NOW(3)
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `)

    const updated = await this.findById(tenantId, id)
    if (!updated) throw new Error('Secret rotate failed')
    return updated
  }

  async revoke(tenantId: number, id: number): Promise<SecretRow> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE secrets
      SET revoked_at = COALESCE(revoked_at, NOW(3)), updated_at = NOW(3)
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `)

    const updated = await this.findById(tenantId, id)
    if (!updated) throw new Error('Secret revoke failed')
    return updated
  }

  async delete(tenantId: number, id: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      DELETE FROM secrets
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `)
  }

  async findUserGroupIds(userId: number): Promise<number[]> {
    const rows = await this.db.$queryRaw<Array<{ groupId: number }>>(Prisma.sql`
      SELECT group_id AS groupId
      FROM user_groups
      WHERE user_id = ${userId}
    `)
    return rows.map((row) => row.groupId)
  }

  async groupExistsInTenant(groupId: number, tenantId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT id
      FROM \`groups\`
      WHERE id = ${groupId} AND tenant_id = ${tenantId}
      LIMIT 1
    `)
    return rows.length > 0
  }

  async findByAlias(tenantId: number, alias: string): Promise<SecretRow | null> {
    const rows = await this.db.$queryRaw<SecretRow[]>(Prisma.sql`
      SELECT
        s.id,
        s.tenant_id AS tenantId,
        s.alias,
        s.description,
        s.scope,
        s.owner_user_id AS ownerUserId,
        s.group_id AS groupId,
        s.created_by_user_id AS createdByUserId,
        u.name AS createdByUsername,
        s.source,
        s.encrypted_value AS encryptedValue,
        s.iv,
        s.created_at AS createdAt,
        s.updated_at AS updatedAt,
        s.rotated_at AS rotatedAt,
        s.revoked_at AS revokedAt
      FROM secrets s
      LEFT JOIN users u ON u.id = s.created_by_user_id
      WHERE s.tenant_id = ${tenantId} AND s.alias = ${alias}
      LIMIT 1
    `)

    return rows[0] ? mapRow(rows[0]) : null
  }
}
