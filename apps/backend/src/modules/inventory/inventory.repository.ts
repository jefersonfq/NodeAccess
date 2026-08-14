import { Prisma, type PrismaClient } from '@prisma/client'

export interface InventoryNodeRow {
  id: number
  tenantId: number
  parentId: number | null
  type: 'ROOT' | 'FOLDER' | 'HOST'
  hostId: number | null
  name: string
  path: string
  depth: number
  createdAt: Date
  updatedAt: Date
}

export interface HostWithoutInventoryNodeRow {
  id: number
  name: string
  ip: string
}

export class InventoryRepository {
  constructor(private readonly db: PrismaClient) {}

  async findTree(tenantId: number): Promise<InventoryNodeRow[]> {
    return this.db.$queryRaw<InventoryNodeRow[]>(Prisma.sql`
      SELECT
        id,
        tenant_id AS tenantId,
        parent_id AS parentId,
        type,
        host_id AS hostId,
        name,
        path,
        depth,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM inventory_nodes FORCE INDEX (inventory_nodes_tenant_deleted_depth_name_idx)
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
      ORDER BY depth ASC, name ASC, id ASC
    `)
  }

  async findVisibleTree(tenantId: number, userId: number, role: 'ADMIN' | 'USER'): Promise<InventoryNodeRow[]> {
    if (role === 'ADMIN') return this.findTree(tenantId)

    return this.db.$queryRaw<InventoryNodeRow[]>(Prisma.sql`
      SELECT
        node.id,
        node.tenant_id AS tenantId,
        node.parent_id AS parentId,
        node.type,
        node.host_id AS hostId,
        node.name,
        node.path,
        node.depth,
        node.created_at AS createdAt,
        node.updated_at AS updatedAt
      FROM inventory_nodes node FORCE INDEX (inventory_nodes_tenant_deleted_depth_name_idx)
      WHERE node.tenant_id = ${tenantId}
        AND node.deleted_at IS NULL
        AND (
          node.type = 'ROOT'
          OR EXISTS (
            WITH RECURSIVE ancestors AS (
              SELECT current_node.id, current_node.parent_id, 1 AS is_local
              FROM inventory_nodes current_node
              WHERE current_node.id = node.id
                AND current_node.tenant_id = ${tenantId}
                AND current_node.deleted_at IS NULL

              UNION ALL

              SELECT parent.id, parent.parent_id, 0 AS is_local
              FROM inventory_nodes parent
              INNER JOIN ancestors child ON child.parent_id = parent.id
              WHERE parent.tenant_id = ${tenantId}
                AND parent.deleted_at IS NULL
            )
            SELECT 1
            FROM ancestors
            INNER JOIN resource_acl_entries acl
              ON acl.inventory_node_id = ancestors.id
             AND acl.tenant_id = ${tenantId}
            INNER JOIN users target_user
              ON target_user.id = ${userId}
             AND target_user.tenant_id = ${tenantId}
             AND target_user.deleted_at IS NULL
            WHERE (ancestors.is_local = 1 OR acl.inherit_to_children = true)
              AND acl.can_view = true
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
          )
        )
      ORDER BY node.depth ASC, node.name ASC, node.id ASC
    `)
  }

  async findHostIdsInSubtree(tenantId: number, inventoryNodeId: number): Promise<number[]> {
    const rows = await this.db.$queryRaw<Array<{ hostId: number }>>(Prisma.sql`
      SELECT host_node.host_id AS hostId
      FROM inventory_nodes selected_node
      INNER JOIN inventory_nodes host_node
        ON host_node.tenant_id = selected_node.tenant_id
       AND host_node.deleted_at IS NULL
       AND host_node.type = 'HOST'
       AND host_node.path LIKE CONCAT(selected_node.path, '%')
      WHERE selected_node.id = ${inventoryNodeId}
        AND selected_node.tenant_id = ${tenantId}
        AND selected_node.deleted_at IS NULL
    `)
    return rows.map((row) => row.hostId)
  }

  async findById(id: number, tenantId: number): Promise<InventoryNodeRow | null> {
    const rows = await this.db.$queryRaw<InventoryNodeRow[]>(Prisma.sql`
      SELECT
        id,
        tenant_id AS tenantId,
        parent_id AS parentId,
        type,
        host_id AS hostId,
        name,
        path,
        depth,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM inventory_nodes
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
      LIMIT 1
    `)
    return rows[0] ?? null
  }

  async findByHostId(hostId: number, tenantId: number): Promise<InventoryNodeRow | null> {
    const rows = await this.db.$queryRaw<InventoryNodeRow[]>(Prisma.sql`
      SELECT
        id, tenant_id AS tenantId, parent_id AS parentId, type, host_id AS hostId,
        name, path, depth, created_at AS createdAt, updated_at AS updatedAt
      FROM inventory_nodes
      WHERE host_id = ${hostId}
        AND tenant_id = ${tenantId}
        AND type = 'HOST'
        AND deleted_at IS NULL
      LIMIT 1
    `)
    return rows[0] ?? null
  }

  async findAncestorIdsForHost(hostId: number, tenantId: number): Promise<number[]> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM inventory_nodes
        WHERE tenant_id = ${tenantId} AND host_id = ${hostId} AND deleted_at IS NULL
        UNION ALL
        SELECT parent.id, parent.parent_id FROM inventory_nodes parent
        INNER JOIN ancestors child ON child.parent_id = parent.id
        WHERE parent.tenant_id = ${tenantId} AND parent.deleted_at IS NULL
      ) SELECT id FROM ancestors
    `)
    return rows.map((row) => row.id)
  }

  async findRoot(tenantId: number): Promise<InventoryNodeRow | null> {
    const rows = await this.db.$queryRaw<InventoryNodeRow[]>(Prisma.sql`
      SELECT
        id, tenant_id AS tenantId, parent_id AS parentId, type, host_id AS hostId,
        name, path, depth, created_at AS createdAt, updated_at AS updatedAt
      FROM inventory_nodes
      WHERE tenant_id = ${tenantId}
        AND type = 'ROOT'
        AND deleted_at IS NULL
      LIMIT 1
    `)
    return rows[0] ?? null
  }

  async findHostsWithoutInventoryNode(
    tenantId: number,
    limit: number,
  ): Promise<{ total: number; sample: HostWithoutInventoryNodeRow[] }> {
    const [countRows, sample] = await this.db.$transaction([
      this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM hosts h
        LEFT JOIN inventory_nodes node
          ON node.host_id = h.id
         AND node.tenant_id = h.tenant_id
         AND node.type = 'HOST'
         AND node.deleted_at IS NULL
        WHERE h.tenant_id = ${tenantId}
          AND h.deleted_at IS NULL
          AND node.id IS NULL
      `),
      this.db.$queryRaw<HostWithoutInventoryNodeRow[]>(Prisma.sql`
        SELECT h.id, h.name, h.ip
        FROM hosts h
        LEFT JOIN inventory_nodes node
          ON node.host_id = h.id
         AND node.tenant_id = h.tenant_id
         AND node.type = 'HOST'
         AND node.deleted_at IS NULL
        WHERE h.tenant_id = ${tenantId}
          AND h.deleted_at IS NULL
          AND node.id IS NULL
        ORDER BY h.id ASC
        LIMIT ${limit}
      `),
    ])
    return {
      total: Number(countRows[0]?.total ?? 0),
      sample,
    }
  }

  async createMissingHostNodesUnderRoot(tenantId: number, actorId: number): Promise<number> {
    return this.db.$transaction(async (tx) => {
      const created = await tx.$executeRaw(Prisma.sql`
        INSERT INTO inventory_nodes
          (tenant_id, parent_id, type, host_id, name, path, depth, updated_by_id, updated_at)
        SELECT
          h.tenant_id,
          root_node.id,
          'HOST',
          h.id,
          h.name,
          '',
          root_node.depth + 1,
          ${actorId},
          CURRENT_TIMESTAMP(3)
        FROM hosts h
        INNER JOIN inventory_nodes root_node
          ON root_node.tenant_id = h.tenant_id
         AND root_node.type = 'ROOT'
         AND root_node.deleted_at IS NULL
        LEFT JOIN inventory_nodes existing_node
          ON existing_node.host_id = h.id
         AND existing_node.tenant_id = h.tenant_id
         AND existing_node.type = 'HOST'
         AND existing_node.deleted_at IS NULL
        WHERE h.tenant_id = ${tenantId}
          AND h.deleted_at IS NULL
          AND existing_node.id IS NULL
      `)

      if (created > 0) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE inventory_nodes node
          INNER JOIN inventory_nodes parent_node ON parent_node.id = node.parent_id
          SET
            node.path = CONCAT(parent_node.path, node.id, '/'),
            node.updated_at = CURRENT_TIMESTAMP(3)
          WHERE node.tenant_id = ${tenantId}
            AND node.type = 'HOST'
            AND node.deleted_at IS NULL
            AND node.path = ''
        `)
      }

      return created
    })
  }

  async existsActiveSibling(tenantId: number, parentId: number, name: string, excludeId?: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM inventory_nodes
      WHERE tenant_id = ${tenantId}
        AND parent_id = ${parentId}
        AND name = ${name}
        AND deleted_at IS NULL
        ${excludeId === undefined ? Prisma.empty : Prisma.sql`AND id <> ${excludeId}`}
    `)
    return Number(rows[0]?.total ?? 0) > 0
  }

  async createFolder(data: {
    tenantId: number
    parentId: number
    name: string
    actorId: number
    parentPath: string
    parentDepth: number
  }): Promise<InventoryNodeRow> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO inventory_nodes
          (tenant_id, parent_id, type, name, path, depth, created_by_id, updated_by_id, updated_at)
        VALUES
          (${data.tenantId}, ${data.parentId}, 'FOLDER', ${data.name}, '', ${data.parentDepth + 1},
           ${data.actorId}, ${data.actorId}, CURRENT_TIMESTAMP(3))
      `)
      const ids = await tx.$queryRaw<Array<{ id: bigint | number }>>(Prisma.sql`SELECT LAST_INSERT_ID() AS id`)
      const id = Number(ids[0]?.id)
      const path = `${data.parentPath}${id}/`
      await tx.$executeRaw(Prisma.sql`
        UPDATE inventory_nodes SET path = ${path} WHERE id = ${id}
      `)
      const rows = await tx.$queryRaw<InventoryNodeRow[]>(Prisma.sql`
        SELECT
          id, tenant_id AS tenantId, parent_id AS parentId, type, host_id AS hostId,
          name, path, depth, created_at AS createdAt, updated_at AS updatedAt
        FROM inventory_nodes WHERE id = ${id}
      `)
      return rows[0]!
    })
  }

  async renameFolder(id: number, tenantId: number, name: string, actorId: number): Promise<InventoryNodeRow> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE inventory_nodes
      SET name = ${name}, updated_by_id = ${actorId}, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${id} AND tenant_id = ${tenantId} AND type = 'FOLDER' AND deleted_at IS NULL
    `)
    return (await this.findById(id, tenantId))!
  }

  async hasActiveChildren(id: number, tenantId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM inventory_nodes
      WHERE tenant_id = ${tenantId} AND parent_id = ${id} AND deleted_at IS NULL
    `)
    return Number(rows[0]?.total ?? 0) > 0
  }

  async deleteFolder(id: number, tenantId: number, actorId: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE inventory_nodes
      SET
        name = CONCAT('__deleted__', id),
        deleted_at = CURRENT_TIMESTAMP(3),
        updated_by_id = ${actorId},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${id} AND tenant_id = ${tenantId} AND type = 'FOLDER' AND deleted_at IS NULL
    `)
  }

  async moveHost(nodeId: number, tenantId: number, parent: InventoryNodeRow, actorId: number): Promise<InventoryNodeRow> {
    const path = `${parent.path}${nodeId}/`
    await this.db.$executeRaw(Prisma.sql`
      UPDATE inventory_nodes
      SET
        parent_id = ${parent.id},
        path = ${path},
        depth = ${parent.depth + 1},
        updated_by_id = ${actorId},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${nodeId}
        AND tenant_id = ${tenantId}
        AND type = 'HOST'
        AND deleted_at IS NULL
    `)
    return (await this.findById(nodeId, tenantId))!
  }

  async moveFolder(folder: InventoryNodeRow, tenantId: number, parent: InventoryNodeRow, actorId: number): Promise<InventoryNodeRow> {
    const previousPath = folder.path
    const nextPath = `${parent.path}${folder.id}/`
    const depthDelta = parent.depth + 1 - folder.depth
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE inventory_nodes
        SET
          parent_id = CASE WHEN id = ${folder.id} THEN ${parent.id} ELSE parent_id END,
          path = CONCAT(${nextPath}, SUBSTRING(path, ${previousPath.length + 1})),
          depth = depth + ${depthDelta},
          updated_by_id = ${actorId},
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND path LIKE ${`${previousPath}%`}
      `)
    })
    return (await this.findById(folder.id, tenantId))!
  }
}
