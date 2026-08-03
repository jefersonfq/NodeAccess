import type { Group } from '@prisma/client'
import type { GroupPublic, CreateGroupDto, UpdateGroupDto, Paginated } from '@nodeaccess/shared'
import { NotFoundError, ConflictError, ValidationError } from '../../shared/errors.js'
import type { GroupInventoryAclRow, GroupListFilters, GroupRepository } from './group.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

function toPublic(group: Group): GroupPublic {
  return {
    id:          group.id,
    tenantId:    group.tenantId,
    name:        group.name,
    description: group.description,
    bastionId:   group.bastionId,
    createdAt:   group.createdAt,
  }
}

export interface GroupInventoryAclPublic {
  aclEntryId: number
  inventoryNodeId: number
  inventoryNodeName: string
  inventoryNodeType: 'ROOT' | 'FOLDER' | 'HOST'
  permissions: {
    view: boolean
    connect: boolean
    edit: boolean
    admin: boolean
  }
  inheritToChildren: boolean
  hostCount: number
  updatedAt: Date
}

function toAclPublic(row: GroupInventoryAclRow): GroupInventoryAclPublic {
  return {
    aclEntryId: row.aclEntryId,
    inventoryNodeId: row.inventoryNodeId,
    inventoryNodeName: row.inventoryNodeName,
    inventoryNodeType: row.inventoryNodeType,
    permissions: {
      view: Boolean(row.canView),
      connect: Boolean(row.canConnect),
      edit: Boolean(row.canEdit),
      admin: Boolean(row.canAdmin),
    },
    inheritToChildren: Boolean(row.inheritToChildren),
    hostCount: Number(row.hostCount),
    updatedAt: row.updatedAt,
  }
}

export class GroupService {
  constructor(
    private readonly groupRepo: GroupRepository,
    private readonly logRepo:   LogRepository,
  ) {}

  async list(tenantId: number, userId: number, role: 'ADMIN' | 'USER'): Promise<GroupPublic[]> {
    const groups = role === 'ADMIN'
      ? await this.groupRepo.findAll(tenantId)
      : await this.groupRepo.findAllForUser(tenantId, userId)
    return groups.map(toPublic)
  }

  async listPaginated(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    filters: GroupListFilters,
  ): Promise<Paginated<GroupPublic>> {
    const page  = Math.max(1, filters.page ?? 1)
    const limit = Math.max(1, Math.min(100, filters.limit ?? 20))
    const { groups, total } = await this.groupRepo.findPaginated(tenantId, userId, role, { ...filters, page, limit })

    return {
      data: groups.map(toPublic),
      total,
      page,
      limit,
    }
  }

  async getById(id: number, tenantId: number): Promise<GroupPublic> {
    const group = await this.groupRepo.findById(id, tenantId)
    if (!group) throw new NotFoundError('Grupo')
    return toPublic(group)
  }

  async listInventoryAcl(id: number, tenantId: number): Promise<GroupInventoryAclPublic[]> {
    const group = await this.groupRepo.findById(id, tenantId)
    if (!group) throw new NotFoundError('Grupo')
    return (await this.groupRepo.findInventoryAclEntries(id, tenantId)).map(toAclPublic)
  }

  async create(dto: CreateGroupDto, tenantId: number, adminId: number): Promise<GroupPublic> {
    const exists = await this.groupRepo.existsByName(dto.name, tenantId)
    if (exists) throw new ConflictError('Já existe um grupo com este nome')
    await this.assertTenantBastion(dto.bastionId, tenantId)

    const group = await this.groupRepo.create({
      name:        dto.name,
      tenantId,
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.bastionId !== undefined && { bastionId: dto.bastionId }),
    })
    await this.logRepo.logAdminEvent({ adminId, action: 'CREATE_GROUP', targetType: 'Group', targetId: group.id }).catch(() => { /* best-effort */ })
    return toPublic(group)
  }

  async update(id: number, dto: UpdateGroupDto, tenantId: number, adminId: number): Promise<GroupPublic> {
    const group = await this.groupRepo.findById(id, tenantId)
    if (!group) throw new NotFoundError('Grupo')

    if (dto.name && dto.name !== group.name) {
      const exists = await this.groupRepo.existsByName(dto.name, tenantId, id)
      if (exists) throw new ConflictError('Já existe um grupo com este nome')
    }
    await this.assertTenantBastion(dto.bastionId, tenantId)

    const updated = await this.groupRepo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.bastionId !== undefined && { bastionId: dto.bastionId }),
    })
    await this.logRepo.logAdminEvent({ adminId, action: 'UPDATE_GROUP', targetType: 'Group', targetId: id }).catch(() => { /* best-effort */ })
    return toPublic(updated)
  }

  async delete(id: number, tenantId: number, adminId: number): Promise<void> {
    const group = await this.groupRepo.findById(id, tenantId)
    if (!group) throw new NotFoundError('Grupo')

    if (await this.groupRepo.hasHosts(id)) {
      throw new ConflictError('Não é possível excluir um grupo com hosts ativos vinculados')
    }
    if (await this.groupRepo.hasUsers(id)) {
      throw new ConflictError('Não é possível excluir um grupo com usuários vinculados')
    }

    await this.groupRepo.delete(id)
    await this.logRepo.logAdminEvent({ adminId, action: 'DELETE_GROUP', targetType: 'Group', targetId: id }).catch(() => { /* best-effort */ })
  }

  private async assertTenantBastion(bastionId: number | undefined, tenantId: number): Promise<void> {
    if (bastionId === undefined) return
    if (await this.groupRepo.bastionExists(bastionId, tenantId)) return
    throw new ValidationError('Bastion não encontrado neste tenant')
  }
}
