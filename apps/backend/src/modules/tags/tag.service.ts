import type { TagPublic } from '@nodeaccess/shared'
import type { TagRepository } from './tag.repository.js'
import { ConflictError, NotFoundError } from '../../shared/errors.js'

export class TagService {
  constructor(private readonly tagRepo: TagRepository) {}

  async list(tenantId: number): Promise<TagPublic[]> {
    const tags = await this.tagRepo.listByTenant(tenantId)
    return tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))
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
