import { Prisma, type PrismaClient } from '@prisma/client'

export type SecretScope = 'PERSONAL' | 'GROUP' | 'TENANT'

export interface SecretRow {
  id: number
  tenantId: number
  alias: string
  description: string | null
  scope: SecretScope
  ownerUserId: number | null
  groupId: number | null
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
        id,
        tenant_id AS tenantId,
        alias,
        description,
        scope,
        owner_user_id AS ownerUserId,
        group_id AS groupId,
        encrypted_value AS encryptedValue,
        iv,
        created_at AS createdAt,
        updated_at AS updatedAt,
        rotated_at AS rotatedAt,
        revoked_at AS revokedAt
      FROM secrets
      WHERE tenant_id = ${params.tenantId}
        ${params.includeRevoked ? Prisma.empty : Prisma.sql`AND revoked_at IS NULL`}
        AND (
          ${params.isAdmin}
          OR owner_user_id = ${params.userId}
          OR scope = ${'TENANT'}
          OR ${params.groupIds.length > 0 ? Prisma.sql`group_id IN (${Prisma.join(params.groupIds)})` : Prisma.sql`FALSE`}
        )
      ORDER BY revoked_at IS NULL DESC, scope ASC, alias ASC
    `)

    return rows.map(mapRow)
  }

  async findById(tenantId: number, id: number): Promise<SecretRow | null> {
    const rows = await this.db.$queryRaw<SecretRow[]>(Prisma.sql`
      SELECT
        id,
        tenant_id AS tenantId,
        alias,
        description,
        scope,
        owner_user_id AS ownerUserId,
        group_id AS groupId,
        encrypted_value AS encryptedValue,
        iv,
        created_at AS createdAt,
        updated_at AS updatedAt,
        rotated_at AS rotatedAt,
        revoked_at AS revokedAt
      FROM secrets
      WHERE tenant_id = ${tenantId} AND id = ${id}
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
        id,
        tenant_id AS tenantId,
        alias,
        description,
        scope,
        owner_user_id AS ownerUserId,
        group_id AS groupId,
        encrypted_value AS encryptedValue,
        iv,
        created_at AS createdAt,
        updated_at AS updatedAt,
        rotated_at AS rotatedAt,
        revoked_at AS revokedAt
      FROM secrets
      WHERE tenant_id = ${params.tenantId}
        AND revoked_at IS NULL
        AND alias IN (${Prisma.join(params.aliases)})
        AND (
          ${params.isAdmin}
          OR owner_user_id = ${params.userId}
          OR scope = ${'TENANT'}
          OR ${params.groupIds.length > 0 ? Prisma.sql`group_id IN (${Prisma.join(params.groupIds)})` : Prisma.sql`FALSE`}
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
      FROM groups
      WHERE id = ${groupId} AND tenant_id = ${tenantId}
      LIMIT 1
    `)
    return rows.length > 0
  }

  private async findByAlias(tenantId: number, alias: string): Promise<SecretRow | null> {
    const rows = await this.db.$queryRaw<SecretRow[]>(Prisma.sql`
      SELECT
        id,
        tenant_id AS tenantId,
        alias,
        description,
        scope,
        owner_user_id AS ownerUserId,
        group_id AS groupId,
        encrypted_value AS encryptedValue,
        iv,
        created_at AS createdAt,
        updated_at AS updatedAt,
        rotated_at AS rotatedAt,
        revoked_at AS revokedAt
      FROM secrets
      WHERE tenant_id = ${tenantId} AND alias = ${alias}
      LIMIT 1
    `)

    return rows[0] ? mapRow(rows[0]) : null
  }
}
