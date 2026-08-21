import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import type { FolderRepository } from './folder.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

export interface FolderPublic {
  id:        number
  name:      string
  userId:    number
  tenantId:  number
  parentId:  number | null
  createdAt: Date
}

export class FolderService {
  constructor(
    private readonly repo:    FolderRepository,
    private readonly logRepo: LogRepository,
  ) {}

  async list(userId: number, tenantId: number): Promise<FolderPublic[]> {
    return this.repo.findAll(userId, tenantId)
  }

  async create(name: string, parentId: number | null, userId: number, tenantId: number): Promise<FolderPublic> {
    if (parentId !== null && !await this.repo.findById(parentId, userId, tenantId)) {
      throw new NotFoundError('Pasta pai')
    }
    if (await this.repo.existsByName(name, userId, tenantId, parentId)) {
      throw new ConflictError(`Pasta "${name}" já existe`)
    }
    let folder: FolderPublic
    try {
      folder = await this.repo.create({ name, userId, tenantId, parentId })
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictError(`Pasta "${name}" já existe`)
      }
      throw error
    }
    await this.logRepo.logAdminEvent({ adminId: userId, action: 'CREATE_FOLDER', targetType: 'Folder', targetId: folder.id }).catch(() => { /* best-effort */ })
    return folder
  }

  async update(id: number, name: string, userId: number, tenantId: number): Promise<FolderPublic> {
    const folder = await this.repo.findById(id, userId, tenantId)
    if (!folder) throw new NotFoundError('Pasta')
    if (await this.repo.existsByName(name, userId, tenantId, folder.parentId, id)) {
      throw new ConflictError(`Pasta "${name}" já existe`)
    }
    const updated = await this.repo.update(id, userId, name)
    await this.logRepo.logAdminEvent({ adminId: userId, action: 'UPDATE_FOLDER', targetType: 'Folder', targetId: id }).catch(() => { /* best-effort */ })
    return updated
  }

  async delete(id: number, userId: number, tenantId: number): Promise<void> {
    const folder = await this.repo.findById(id, userId, tenantId)
    if (!folder) throw new NotFoundError('Pasta')
    if (folder.userId !== userId) throw new ForbiddenError()
    if (await this.repo.countChildren(id, userId, folder.tenantId)) {
      throw new ConflictError('Exclua ou mova as subpastas antes de excluir esta pasta')
    }
    await this.repo.delete(id, userId)
    await this.logRepo.logAdminEvent({ adminId: userId, action: 'DELETE_FOLDER', targetType: 'Folder', targetId: id }).catch(() => { /* best-effort */ })
  }
}
