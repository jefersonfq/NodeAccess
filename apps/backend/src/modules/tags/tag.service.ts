import type { TagPublic } from '@nodeaccess/shared'
import type { TagRepository } from './tag.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js'

export class TagService {
  constructor(private readonly tagRepo: TagRepository) {}

  async list(tenantId: number): Promise<TagPublic[]> {
    const tags = await this.tagRepo.listByTenant(tenantId)
    return tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))
  }

  async create(name: string, tenantId: number): Promise<TagPublic> {
    const normalizedName = name.trim()
    if (!normalizedName) throw new ValidationError('Nome da tag e obrigatorio')
    const tag = await this.tagRepo.upsertByName(tenantId, normalizedName)
    return { id: tag.id, name: tag.name, color: tag.color }
  }

  async update(id: number, tenantId: number, data: { name: string; color: string }): Promise<TagPublic> {
    const name = data.name.trim()
    if (!name || name.length > 50 || !/^#[0-9a-f]{6}$/i.test(data.color)) throw new ValidationError('Nome ou cor inválidos')
    if (!await this.tagRepo.findById(id, tenantId)) throw new NotFoundError('Tag')
    try {
      const tag = await this.tagRepo.update(id, tenantId, { name, color: data.color })
      return { id: tag.id, name: tag.name, color: tag.color }
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictError('Já existe uma tag com esse nome')
      throw error
    }
  }

  async delete(id: number, tenantId: number): Promise<void> {
    const tag = await this.tagRepo.findById(id, tenantId)
    if (!tag) throw new NotFoundError('Tag')

    const usageCount = await this.tagRepo.countHostsByTagId(id)
    if (usageCount > 0) {
      throw new ConflictError('Nao e possivel excluir uma tag associada a hosts')
    }

    await this.tagRepo.delete(id)
  }
}
