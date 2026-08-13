import { ConflictError, NotFoundError } from '../../shared/errors.js'
import type { UserRepository } from '../users/user.repository.js'
import type { OidcGroupMappingRepository } from './oidc-group-mapping.repository.js'

export class OidcGroupMappingService {
  constructor(private readonly repository: OidcGroupMappingRepository, private readonly users: UserRepository) {}

  list(tenantId: number) { return this.repository.list(tenantId) }

  async create(input: { tenantId: number; adminId: number; externalGroup: string; groupId: number }) {
    try {
      const result = await this.repository.create(input)
      if (!result) throw new NotFoundError('Grupo interno')
      await this.users.logAdminEvent({ adminId: input.adminId, action: 'CREATE_OIDC_GROUP_MAPPING', targetType: 'OidcGroupMapping', targetId: result.id, details: JSON.stringify({ groupId: result.groupId }) }).catch(() => {})
      return result
    } catch (error: unknown) {
      if (error instanceof NotFoundError) throw error
      if ((error as { code?: string }).code === 'P2002') throw new ConflictError('O grupo externo ou interno já possui um mapeamento')
      throw error
    }
  }

  async delete(tenantId: number, adminId: number, id: number): Promise<void> {
    if (!await this.repository.delete(tenantId, id)) throw new NotFoundError('Mapeamento OIDC')
    await this.users.logAdminEvent({ adminId, action: 'DELETE_OIDC_GROUP_MAPPING', targetType: 'OidcGroupMapping', targetId: id }).catch(() => {})
  }
}
