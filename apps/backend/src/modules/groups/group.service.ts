import type { Group } from '@prisma/client'
import type { GroupPublic, CreateGroupDto, UpdateGroupDto } from '@nodeaccess/shared'
import { NotFoundError, ConflictError } from '../../shared/errors.js'
import type { GroupRepository } from './group.repository.js'
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

  async getById(id: number, tenantId: number): Promise<GroupPublic> {
    const group = await this.groupRepo.findById(id, tenantId)
    if (!group) throw new NotFoundError('Grupo')
    return toPublic(group)
  }

  async create(dto: CreateGroupDto, tenantId: number, adminId: number): Promise<GroupPublic> {
    const exists = await this.groupRepo.existsByName(dto.name, tenantId)
    if (exists) throw new ConflictError('Já existe um grupo com este nome')

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
      throw new ConflictError('Não é possível excluir um grupo com hosts vinculados')
    }
    if (await this.groupRepo.hasUsers(id)) {
      throw new ConflictError('Não é possível excluir um grupo com usuários vinculados')
    }

    await this.groupRepo.delete(id)
    await this.logRepo.logAdminEvent({ adminId, action: 'DELETE_GROUP', targetType: 'Group', targetId: id }).catch(() => { /* best-effort */ })
  }
}
