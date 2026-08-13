import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'

export interface OidcGroupMappingRow {
  id: number
  externalGroup: string
  groupId: number
  groupName: string
  createdAt: Date
  updatedAt: Date
}

export class OidcGroupMappingRepository {
  constructor(private readonly db: PrismaClient) {}

  list(tenantId: number): Promise<OidcGroupMappingRow[]> {
    return this.db.$queryRaw`
      SELECT mapping.id, mapping.external_group AS externalGroup,
             mapping.group_id AS groupId, internal_group.name AS groupName,
             mapping.created_at AS createdAt, mapping.updated_at AS updatedAt
      FROM oidc_group_mappings mapping
      INNER JOIN groups internal_group ON internal_group.id = mapping.group_id
        AND internal_group.tenant_id = mapping.tenant_id
      WHERE mapping.tenant_id = ${tenantId}
      ORDER BY mapping.external_group ASC
    `
  }

  async create(input: { tenantId: number; externalGroup: string; groupId: number; adminId: number }): Promise<OidcGroupMappingRow | null> {
    const group = await this.db.group.findFirst({ where: { id: input.groupId, tenantId: input.tenantId }, select: { id: true } })
    if (!group) return null
    await this.db.$executeRaw`
      INSERT INTO oidc_group_mappings
        (tenant_id, external_group, external_group_normalized, group_id, created_by_user_id, created_at, updated_at)
      VALUES (${input.tenantId}, ${input.externalGroup.trim()}, ${normalizeGroup(input.externalGroup)}, ${input.groupId}, ${input.adminId}, ${new Date()}, ${new Date()})
    `
    const rows = await this.db.$queryRaw<OidcGroupMappingRow[]>`
      SELECT mapping.id, mapping.external_group AS externalGroup, mapping.group_id AS groupId,
             internal_group.name AS groupName, mapping.created_at AS createdAt, mapping.updated_at AS updatedAt
      FROM oidc_group_mappings mapping
      INNER JOIN groups internal_group ON internal_group.id = mapping.group_id
      WHERE mapping.tenant_id = ${input.tenantId}
        AND mapping.external_group_normalized = ${normalizeGroup(input.externalGroup)}
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async delete(tenantId: number, id: number): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM oidc_group_mappings WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1 FOR UPDATE`
      if (!rows[0]) return false
      await tx.$executeRaw`DELETE FROM oidc_group_mappings WHERE id = ${id} AND tenant_id = ${tenantId}`
      return true
    })
  }

  async sync(input: { tenantId: number; userId: number; identityId: number; externalGroups: string[] }): Promise<void> {
    const normalized = [...new Set(input.externalGroups.map(normalizeGroup).filter(Boolean))]
    const mappings = normalized.length
      ? await this.db.$queryRaw<Array<{ id: number; groupId: number }>>(Prisma.sql`
          SELECT id, group_id AS groupId FROM oidc_group_mappings
          WHERE tenant_id = ${input.tenantId}
            AND external_group_normalized IN (${Prisma.join(normalized)})
        `)
      : []
    const mappingIds = mappings.map((item) => item.id)
    await this.db.$transaction(async (tx) => {
      if (mappingIds.length) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM user_groups WHERE user_id = ${input.userId} AND source = 'OIDC' AND external_identity_id = ${input.identityId} AND oidc_group_mapping_id NOT IN (${Prisma.join(mappingIds)})`)
      } else {
        await tx.$executeRaw`DELETE FROM user_groups WHERE user_id = ${input.userId} AND source = 'OIDC' AND external_identity_id = ${input.identityId}`
      }
      for (const mapping of mappings) {
        const existing = await tx.userGroup.findUnique({ where: { userId_groupId: { userId: input.userId, groupId: mapping.groupId } } })
        if (!existing) {
          await tx.$executeRaw`INSERT INTO user_groups (user_id, group_id, source, external_identity_id, oidc_group_mapping_id, created_at) VALUES (${input.userId}, ${mapping.groupId}, 'OIDC', ${input.identityId}, ${mapping.id}, ${new Date()})`
        }
      }
    })
  }
}

export function normalizeGroup(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}
