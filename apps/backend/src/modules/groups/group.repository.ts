import { Prisma, type PrismaClient, type Group } from '@prisma/client'

export interface GroupListFilters {
  page?: number
  limit?: number
  search?: string
}

export interface GroupInventoryAclRow {
  aclEntryId: number
  inventoryNodeId: number
  inventoryNodeName: string
  inventoryNodeType: 'ROOT' | 'FOLDER' | 'HOST'
  inventoryNodePath: string
  canView: boolean | number
  canConnect: boolean | number
  canEdit: boolean | number
  canAdmin: boolean | number
  inheritToChildren: boolean | number
  hostCount: bigint | number
  updatedAt: Date
}

export class GroupRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(tenantId: number): Promise<Group[]> {
    return this.db.group.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    })
  }

  async findAllForUser(tenantId: number, userId: number): Promise<Group[]> {
    return this.db.group.findMany({
      where: {
        tenantId,
        users: {
          some: { userId },
        },
      },
      orderBy: { name: 'asc' },
    })
  }

  async findPaginated(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    filters: GroupListFilters,
  ): Promise<{ groups: Group[]; total: number }> {
    const page  = Math.max(1, filters.page ?? 1)
    const limit = Math.max(1, Math.min(100, filters.limit ?? 20))
    const search = filters.search?.trim()
    const where: Prisma.GroupWhereInput = {
      tenantId,
      ...(role === 'USER' && {
        users: {
          some: { userId },
        },
      }),
      ...(search && {
        OR: [
          { name: { contains: search } },
          { description: { contains: search } },
        ],
      }),
    }

    const [groups, total] = await this.db.$transaction([
      this.db.group.findMany({
        where,
        orderBy: { name: 'asc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      this.db.group.count({ where }),
    ])

    return { groups, total }
  }

  async findById(id: number, tenantId: number): Promise<Group | null> {
    return this.db.group.findFirst({ where: { id, tenantId } })
  }

  async findInventoryAclEntries(groupId: number, tenantId: number): Promise<GroupInventoryAclRow[]> {
    return this.db.$queryRaw<GroupInventoryAclRow[]>(Prisma.sql`
      SELECT
        acl.id AS aclEntryId,
        node.id AS inventoryNodeId,
        node.name AS inventoryNodeName,
        node.type AS inventoryNodeType,
        node.path AS inventoryNodePath,
        acl.can_view AS canView,
        acl.can_connect AS canConnect,
        acl.can_edit AS canEdit,
        acl.can_admin AS canAdmin,
        acl.inherit_to_children AS inheritToChildren,
        (
          SELECT COUNT(*)
          FROM inventory_nodes host_node
          WHERE host_node.tenant_id = node.tenant_id
            AND host_node.deleted_at IS NULL
            AND host_node.type = 'HOST'
            AND host_node.path LIKE CONCAT(node.path, '%')
        ) AS hostCount,
        acl.updated_at AS updatedAt
      FROM resource_acl_entries acl
      INNER JOIN inventory_nodes node
        ON node.id = acl.inventory_node_id
       AND node.tenant_id = ${tenantId}
       AND node.deleted_at IS NULL
      WHERE acl.tenant_id = ${tenantId}
        AND acl.principal_type = 'GROUP'
        AND acl.principal_id = ${groupId}
      ORDER BY node.depth ASC, node.name ASC, acl.id ASC
    `)
  }

  async create(data: {
    name: string
    description?: string
    bastionId?: number
    tenantId: number
  }): Promise<Group> {
    return this.db.group.create({ data })
  }

  async update(
    id: number,
    data: { name?: string; description?: string; bastionId?: number | null },
  ): Promise<Group> {
    return this.db.group.update({ where: { id }, data })
  }

  async delete(id: number): Promise<void> {
    await this.db.group.delete({ where: { id } })
  }

  async hasHosts(id: number): Promise<boolean> {
    const count = await this.db.host.count({ where: { groupId: id, deletedAt: null } })
    return count > 0
  }

  async hasUsers(id: number): Promise<boolean> {
    const count = await this.db.userGroup.count({ where: { groupId: id } })
    return count > 0
  }

  async existsByName(name: string, tenantId: number, excludeId?: number): Promise<boolean> {
    const group = await this.db.group.findFirst({
      where: { name, tenantId, ...(excludeId !== undefined && { NOT: { id: excludeId } }) },
      select: { id: true },
    })
    return group !== null
  }

  async bastionExists(id: number, tenantId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) AS count
        FROM bastion_hosts
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `,
    )
    return Number(rows[0]?.count ?? 0) > 0
  }
}
