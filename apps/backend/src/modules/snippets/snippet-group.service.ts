import type { PrismaClient, SnippetScope } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'

export interface CreateSnippetGroupDto {
  name:        string
  description?: string | null
  scope:       SnippetScope
}

export interface UpdateSnippetGroupDto {
  name?:        string
  description?: string | null
  scope?:       SnippetScope
}

export class SnippetGroupService {
  constructor(
    private readonly db: PrismaClient,
    private readonly entitlements: LicenseEntitlementService,
  ) {}

  /** Lista grupos visíveis para o usuário:
   *  - seus próprios grupos PERSONAL
   *  - todos os grupos TEAM do tenant
   */
  async list(userId: number, tenantId: number) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    return this.db.snippetGroup.findMany({
      where: {
        tenantId,
        OR: [
          { scope: 'TEAM' },
          { scope: 'PERSONAL', createdById: userId },
        ],
      },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, description: true, scope: true,
        createdById: true, createdAt: true, updatedAt: true,
      },
    })
  }

  async create(userId: number, tenantId: number, dto: CreateSnippetGroupDto) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')
    await this.assertUnique(tenantId, userId, dto.scope, dto.name)

    return this.db.snippetGroup.create({
      data: {
        tenantId,
        createdById: userId,
        name:        dto.name.trim(),
        scope:       dto.scope,
        ...(dto.description != null && { description: dto.description }),
      },
      select: {
        id: true, name: true, description: true, scope: true,
        createdById: true, createdAt: true, updatedAt: true,
      },
    })
  }

  async update(id: number, userId: number, tenantId: number, dto: UpdateSnippetGroupDto) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    const group = await this.db.snippetGroup.findFirst({ where: { id, tenantId } })
    if (!group) throw new AppError('Grupo não encontrado', 404, 'SNIPPET_GROUP_NOT_FOUND')
    if (group.createdById !== userId) throw new AppError('Sem permissão para editar este grupo', 403, 'SNIPPET_GROUP_FORBIDDEN')

    const newScope = dto.scope ?? group.scope
    const newName  = dto.name  ?? group.name
    if (newName !== group.name || newScope !== group.scope) {
      await this.assertUnique(tenantId, userId, newScope, newName, id)
    }

    return this.db.snippetGroup.update({
      where: { id },
      data: {
        ...(dto.name        !== undefined && { name:        dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.scope       !== undefined && { scope:       dto.scope }),
      },
      select: {
        id: true, name: true, description: true, scope: true,
        createdById: true, createdAt: true, updatedAt: true,
      },
    })
  }

  async remove(id: number, userId: number, tenantId: number) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    const group = await this.db.snippetGroup.findFirst({ where: { id, tenantId } })
    if (!group) throw new AppError('Grupo não encontrado', 404, 'SNIPPET_GROUP_NOT_FOUND')
    if (group.createdById !== userId) throw new AppError('Sem permissão para excluir este grupo', 403, 'SNIPPET_GROUP_FORBIDDEN')

    // ON DELETE SET NULL garante que os snippets ficam sem grupo — não são excluídos
    await this.db.snippetGroup.delete({ where: { id } })
  }

  /**
   * Regra de unicidade modular:
   * - TEAM: nome único por tenant entre grupos TEAM
   * - PERSONAL: nome único por (tenant + usuário)
   *
   * Aplicado em código (não constraint de banco) para facilitar mudanças futuras de regra.
   */
  private async assertUnique(
    tenantId: number,
    userId: number,
    scope: SnippetScope,
    name: string,
    excludeId?: number,
  ) {
    const where = scope === 'TEAM'
      ? { tenantId, scope: 'TEAM' as const, name: name.trim(), ...(excludeId && { id: { not: excludeId } }) }
      : { tenantId, createdById: userId, name: name.trim(), ...(excludeId && { id: { not: excludeId } }) }

    const existing = await this.db.snippetGroup.findFirst({ where })
    if (existing) {
      throw new AppError(
        scope === 'TEAM'
          ? 'Já existe um grupo de equipe com este nome'
          : 'Você já tem um grupo com este nome',
        409,
        'SNIPPET_GROUP_DUPLICATE',
      )
    }
  }
}
