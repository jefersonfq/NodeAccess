import type { TagPublic } from '@nodeaccess/shared'
import type { TagRepository } from './tag.repository.js'

export class TagService {
  constructor(private readonly tagRepo: TagRepository) {}

  async list(tenantId: number): Promise<TagPublic[]> {
    const tags = await this.tagRepo.listByTenant(tenantId)
    return tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))
  }
}
