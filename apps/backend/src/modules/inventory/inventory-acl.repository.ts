import { Prisma, type PrismaClient } from '@prisma/client'

export interface EffectiveAclSourceRow {
  aclEntryId: number
  inventoryNodeId: number
  inventoryNodeName: string
  principalType: 'USER' | 'GROUP' | 'ROLE'
  principalId: number
  principalName: string
  canView: boolean | number
  canConnect: boolean | number
  canEdit: boolean | number
  canAdmin: boolean | number
  local: boolean | number
  inheritToChildren: boolean | number
}

export interface InventoryAclEntryRow extends EffectiveAclSourceRow {
  principalName: string
  inheritToChildren: boolean | number
  createdAt: Date
  updatedAt: Date
}

export interface InventoryAclNodeContext {
  hostId: number | null
  name?: string
  type?: 'ROOT' | 'FOLDER' | 'HOST'
}

export interface EffectiveHostPermissionsRow {
  hostId: number
  canView: boolean | number
  canConnect: boolean | number
  canEdit: boolean | number
  canAdmin: boolean | number
}

type HostAclPermission = 'view' | 'connect' | 'edit' | 'admin'

export class InventoryAclRepository {
  constructor(private readonly db: PrismaClient) {}

  async findEffectiveSources(
    inventoryNodeId: number,
    tenantId: number,
    userId: number,
  ): Promise<EffectiveAclSourceRow[]> {
    return this.db.$queryRaw<EffectiveAclSourceRow[]>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, 1 AS is_local
        FROM inventory_nodes
        WHERE id = ${inventoryNodeId}
          AND tenant_id = ${tenantId}
          AND deleted_at IS NULL

        UNION ALL

        SELECT parent.id, parent.parent_id, parent.name, 0 AS is_local
        FROM inventory_nodes parent
        INNER JOIN ancestors child ON child.parent_id = parent.id
        WHERE parent.tenant_id = ${tenantId}
          AND parent.deleted_at IS NULL
      )
      SELECT
        acl.id AS aclEntryId,
        acl.inventory_node_id AS inventoryNodeId,
        ancestors.name AS inventoryNodeName,
        acl.principal_type AS principalType,
        acl.principal_id AS principalId,
        COALESCE(
          u.name,
          g.name,
          CASE acl.principal_id WHEN 1 THEN 'All users' WHEN 2 THEN 'Tenant admins' END,
          CONCAT('#', acl.principal_id)
        ) AS principalName,
        acl.can_view AS canView,
        acl.can_connect AS canConnect,
        acl.can_edit AS canEdit,
        acl.can_admin AS canAdmin,
        ancestors.is_local AS local,
        acl.inherit_to_children AS inheritToChildren
      FROM ancestors
      INNER JOIN resource_acl_entries acl
        ON acl.inventory_node_id = ancestors.id
       AND acl.tenant_id = ${tenantId}
      LEFT JOIN users u
        ON acl.principal_type = 'USER' AND u.id = acl.principal_id AND u.tenant_id = ${tenantId}
      LEFT JOIN \`groups\` g
        ON acl.principal_type = 'GROUP' AND g.id = acl.principal_id AND g.tenant_id = ${tenantId}
      WHERE (ancestors.is_local = 1 OR acl.inherit_to_children = true)
        AND EXISTS (
          SELECT 1 FROM users target_user
          WHERE target_user.id = ${userId}
            AND target_user.tenant_id = ${tenantId}
            AND target_user.deleted_at IS NULL
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
      ORDER BY ancestors.is_local DESC, acl.id ASC
    `)
  }

  async findEffectiveHostPermissions(
    hostIds: number[],
    tenantId: number,
    userId: number,
  ): Promise<EffectiveHostPermissionsRow[]> {
    if (hostIds.length === 0) return []
    return this.db.$queryRaw<EffectiveHostPermissionsRow[]>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT host_node.host_id, host_node.id, host_node.parent_id, 1 AS is_local
        FROM inventory_nodes host_node
        WHERE host_node.host_id IN (${Prisma.join(hostIds)})
          AND host_node.tenant_id = ${tenantId}
          AND host_node.deleted_at IS NULL

        UNION ALL

        SELECT child.host_id, parent.id, parent.parent_id, 0 AS is_local
        FROM inventory_nodes parent
        INNER JOIN ancestors child ON child.parent_id = parent.id
        WHERE parent.tenant_id = ${tenantId}
          AND parent.deleted_at IS NULL
      )
      SELECT
        ancestors.host_id AS hostId,
        MAX(acl.can_view) AS canView,
        MAX(acl.can_connect) AS canConnect,
        MAX(acl.can_edit) AS canEdit,
        MAX(acl.can_admin) AS canAdmin
      FROM ancestors
      INNER JOIN resource_acl_entries acl
        ON acl.inventory_node_id = ancestors.id
       AND acl.tenant_id = ${tenantId}
      INNER JOIN users target_user
        ON target_user.id = ${userId}
       AND target_user.tenant_id = ${tenantId}
       AND target_user.deleted_at IS NULL
      WHERE (ancestors.is_local = 1 OR acl.inherit_to_children = true)
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
      GROUP BY ancestors.host_id
    `)
  }

  async countHostsWithEffectivePermission(
    tenantId: number,
    userId: number,
    permission: HostAclPermission,
  ): Promise<number> {
    const permissionColumn = aclPermissionColumn(permission)
    const rows = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT host_node.host_id, host_node.id, host_node.parent_id, 1 AS is_local
        FROM inventory_nodes host_node
        INNER JOIN hosts host
          ON host.id = host_node.host_id
         AND host.tenant_id = ${tenantId}
         AND host.deleted_at IS NULL
        WHERE host_node.host_id IS NOT NULL
          AND host_node.tenant_id = ${tenantId}
          AND host_node.deleted_at IS NULL

        UNION ALL

        SELECT child.host_id, parent.id, parent.parent_id, 0 AS is_local
        FROM inventory_nodes parent
        INNER JOIN ancestors child ON child.parent_id = parent.id
        WHERE parent.tenant_id = ${tenantId}
          AND parent.deleted_at IS NULL
      )
      SELECT COUNT(*) AS total
      FROM (
        SELECT ancestors.host_id
        FROM ancestors
        INNER JOIN resource_acl_entries acl
          ON acl.inventory_node_id = ancestors.id
         AND acl.tenant_id = ${tenantId}
        INNER JOIN users target_user
          ON target_user.id = ${userId}
         AND target_user.tenant_id = ${tenantId}
         AND target_user.deleted_at IS NULL
        WHERE (ancestors.is_local = 1 OR acl.inherit_to_children = true)
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
        GROUP BY ancestors.host_id
        HAVING MAX(${permissionColumn}) > 0
      ) visible_hosts
    `)
    return Number(rows[0]?.total ?? 0)
  }

  async findHostNodeId(hostId: number, tenantId: number): Promise<number | null> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT id
      FROM inventory_nodes
      WHERE host_id = ${hostId}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
      LIMIT 1
    `)
    return rows[0]?.id ?? null
  }

  async nodeExists(inventoryNodeId: number, tenantId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS total FROM inventory_nodes
      WHERE id = ${inventoryNodeId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
    `)
    return Number(rows[0]?.total ?? 0) === 1
  }

  async findNodeContext(inventoryNodeId: number, tenantId: number): Promise<InventoryAclNodeContext | null> {
    const rows = await this.db.$queryRaw<InventoryAclNodeContext[]>(Prisma.sql`
      SELECT host_id AS hostId, name, type
      FROM inventory_nodes
      WHERE id = ${inventoryNodeId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
      LIMIT 1
    `)
    return rows[0] ?? null
  }

  async principalExists(type: 'USER' | 'GROUP' | 'ROLE', principalId: number, tenantId: number): Promise<boolean> {
    if (type === 'ROLE') return principalId === 1 || principalId === 2
    const rows = type === 'USER'
      ? await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
          SELECT COUNT(*) AS total FROM users
          WHERE id = ${principalId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        `)
      : await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
          SELECT COUNT(*) AS total FROM \`groups\`
          WHERE id = ${principalId} AND tenant_id = ${tenantId}
        `)
    return Number(rows[0]?.total ?? 0) === 1
  }

  async findPrincipalName(type: 'USER' | 'GROUP' | 'ROLE', principalId: number, tenantId: number): Promise<string | null> {
    if (type === 'ROLE') {
      if (principalId === 1) return 'All users'
      if (principalId === 2) return 'Tenant admins'
      return null
    }
    const rows = type === 'USER'
      ? await this.db.$queryRaw<Array<{ name: string }>>(Prisma.sql`
          SELECT name FROM users
          WHERE id = ${principalId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
          LIMIT 1
        `)
      : await this.db.$queryRaw<Array<{ name: string }>>(Prisma.sql`
          SELECT name FROM \`groups\`
          WHERE id = ${principalId} AND tenant_id = ${tenantId}
          LIMIT 1
        `)
    return rows[0]?.name ?? null
  }

  async findApplicableEntries(inventoryNodeId: number, tenantId: number): Promise<InventoryAclEntryRow[]> {
    return this.db.$queryRaw<InventoryAclEntryRow[]>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, 1 AS is_local
        FROM inventory_nodes
        WHERE id = ${inventoryNodeId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        UNION ALL
        SELECT parent.id, parent.parent_id, parent.name, 0 AS is_local
        FROM inventory_nodes parent
        INNER JOIN ancestors child ON child.parent_id = parent.id
        WHERE parent.tenant_id = ${tenantId} AND parent.deleted_at IS NULL
      )
      SELECT
        acl.id AS aclEntryId,
        acl.inventory_node_id AS inventoryNodeId,
        ancestors.name AS inventoryNodeName,
        acl.principal_type AS principalType,
        acl.principal_id AS principalId,
        COALESCE(
          u.name,
          g.name,
          CASE acl.principal_id WHEN 1 THEN 'All users' WHEN 2 THEN 'Tenant admins' END,
          CONCAT('#', acl.principal_id)
        ) AS principalName,
        acl.can_view AS canView,
        acl.can_connect AS canConnect,
        acl.can_edit AS canEdit,
        acl.can_admin AS canAdmin,
        acl.inherit_to_children AS inheritToChildren,
        ancestors.is_local AS local,
        acl.created_at AS createdAt,
        acl.updated_at AS updatedAt
      FROM ancestors
      INNER JOIN resource_acl_entries acl
        ON acl.inventory_node_id = ancestors.id AND acl.tenant_id = ${tenantId}
      LEFT JOIN users u
        ON acl.principal_type = 'USER' AND u.id = acl.principal_id AND u.tenant_id = ${tenantId}
      LEFT JOIN \`groups\` g
        ON acl.principal_type = 'GROUP' AND g.id = acl.principal_id AND g.tenant_id = ${tenantId}
      WHERE ancestors.is_local = 1 OR acl.inherit_to_children = true
      ORDER BY ancestors.is_local DESC, principalName ASC, acl.id ASC
    `)
  }

  async findLocalEntry(
    inventoryNodeId: number,
    tenantId: number,
    principalType: 'USER' | 'GROUP' | 'ROLE',
    principalId: number,
  ): Promise<InventoryAclEntryRow | null> {
    const rows = await this.db.$queryRaw<InventoryAclEntryRow[]>(Prisma.sql`
      SELECT
        acl.id AS aclEntryId,
        acl.inventory_node_id AS inventoryNodeId,
        node.name AS inventoryNodeName,
        acl.principal_type AS principalType,
        acl.principal_id AS principalId,
        COALESCE(
          u.name,
          g.name,
          CASE acl.principal_id WHEN 1 THEN 'All users' WHEN 2 THEN 'Tenant admins' END,
          CONCAT('#', acl.principal_id)
        ) AS principalName,
        acl.can_view AS canView,
        acl.can_connect AS canConnect,
        acl.can_edit AS canEdit,
        acl.can_admin AS canAdmin,
        acl.inherit_to_children AS inheritToChildren,
        1 AS local,
        acl.created_at AS createdAt,
        acl.updated_at AS updatedAt
      FROM resource_acl_entries acl
      INNER JOIN inventory_nodes node
        ON node.id = acl.inventory_node_id
       AND node.tenant_id = ${tenantId}
       AND node.deleted_at IS NULL
      LEFT JOIN users u
        ON acl.principal_type = 'USER' AND u.id = acl.principal_id AND u.tenant_id = ${tenantId}
      LEFT JOIN \`groups\` g
        ON acl.principal_type = 'GROUP' AND g.id = acl.principal_id AND g.tenant_id = ${tenantId}
      WHERE acl.inventory_node_id = ${inventoryNodeId}
        AND acl.tenant_id = ${tenantId}
        AND acl.principal_type = ${principalType}
        AND acl.principal_id = ${principalId}
      LIMIT 1
    `)
    return rows[0] ?? null
  }

  async countHostsInSubtree(inventoryNodeId: number, tenantId: number): Promise<number> {
    const rows = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM inventory_nodes selected_node
      INNER JOIN inventory_nodes host_node
        ON host_node.tenant_id = selected_node.tenant_id
       AND host_node.deleted_at IS NULL
       AND host_node.type = 'HOST'
       AND host_node.path LIKE CONCAT(selected_node.path, '%')
      INNER JOIN hosts host
        ON host.id = host_node.host_id
       AND host.tenant_id = ${tenantId}
       AND host.deleted_at IS NULL
      WHERE selected_node.id = ${inventoryNodeId}
        AND selected_node.tenant_id = ${tenantId}
        AND selected_node.deleted_at IS NULL
    `)
    return Number(rows[0]?.total ?? 0)
  }

  async countActiveAuthenticatedSessionsInSubtreeForPrincipal(
    inventoryNodeId: number,
    tenantId: number,
    principalType: 'USER' | 'GROUP' | 'ROLE',
    principalId: number,
  ): Promise<number> {
    const rows = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      WITH RECURSIVE affected_nodes AS (
        SELECT id, host_id
        FROM inventory_nodes
        WHERE id = ${inventoryNodeId}
          AND tenant_id = ${tenantId}
          AND deleted_at IS NULL

        UNION ALL

        SELECT child.id, child.host_id
        FROM inventory_nodes child
        INNER JOIN affected_nodes parent ON child.parent_id = parent.id
        WHERE child.tenant_id = ${tenantId}
          AND child.deleted_at IS NULL
      )
      SELECT COUNT(DISTINCT s.id) AS total
      FROM affected_nodes node
      INNER JOIN sessions s
        ON s.host_id = node.host_id
       AND s.active = true
       AND COALESCE(s.access_type, 'authenticated') = 'authenticated'
      INNER JOIN users u
        ON u.id = s.user_id
       AND u.tenant_id = ${tenantId}
       AND u.deleted_at IS NULL
      WHERE node.host_id IS NOT NULL
        AND (
          (${principalType} = 'USER' AND u.id = ${principalId})
          OR (
            ${principalType} = 'GROUP'
            AND EXISTS (
              SELECT 1
              FROM user_groups ug
              WHERE ug.user_id = u.id
                AND ug.group_id = ${principalId}
            )
          )
          OR (
            ${principalType} = 'ROLE'
            AND (
              ${principalId} = 1
              OR (${principalId} = 2 AND u.role = 'ADMIN')
            )
          )
        )
    `)
    return Number(rows[0]?.total ?? 0)
  }

  async upsert(data: {
    tenantId: number
    inventoryNodeId: number
    principalType: 'USER' | 'GROUP' | 'ROLE'
    principalId: number
    canView: boolean
    canConnect: boolean
    canEdit: boolean
    canAdmin: boolean
    inheritToChildren: boolean
    actorId: number
  }): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO resource_acl_entries (
        tenant_id, inventory_node_id, principal_type, principal_id,
        can_view, can_connect, can_edit, can_admin, inherit_to_children,
        created_by_id, updated_at
      ) VALUES (
        ${data.tenantId}, ${data.inventoryNodeId}, ${data.principalType}, ${data.principalId},
        ${data.canView}, ${data.canConnect}, ${data.canEdit}, ${data.canAdmin}, ${data.inheritToChildren},
        ${data.actorId}, CURRENT_TIMESTAMP(3)
      )
      ON DUPLICATE KEY UPDATE
        can_view = VALUES(can_view),
        can_connect = VALUES(can_connect),
        can_edit = VALUES(can_edit),
        can_admin = VALUES(can_admin),
        inherit_to_children = VALUES(inherit_to_children),
        updated_at = CURRENT_TIMESTAMP(3)
    `)
  }

  async delete(
    inventoryNodeId: number,
    tenantId: number,
    principalType: 'USER' | 'GROUP' | 'ROLE',
    principalId: number,
  ): Promise<boolean> {
    const affected = await this.db.$executeRaw(Prisma.sql`
      DELETE FROM resource_acl_entries
      WHERE inventory_node_id = ${inventoryNodeId}
        AND tenant_id = ${tenantId}
        AND principal_type = ${principalType}
        AND principal_id = ${principalId}
    `)
    return affected === 1
  }
}

function aclPermissionColumn(permission: HostAclPermission): Prisma.Sql {
  switch (permission) {
    case 'view':
      return Prisma.raw('acl.can_view')
    case 'connect':
      return Prisma.raw('acl.can_connect')
    case 'edit':
      return Prisma.raw('acl.can_edit')
    case 'admin':
      return Prisma.raw('acl.can_admin')
  }
}
