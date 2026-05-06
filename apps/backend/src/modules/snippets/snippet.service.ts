import type { PrismaClient, SnippetScope } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'

export interface CreateSnippetDto {
  name:        string
  command:     string
  description?: string | null
  scope:       SnippetScope
  groupId?:    number | null
}

export interface UpdateSnippetDto {
  name?:        string
  command?:     string
  description?: string | null
  scope?:       SnippetScope
  groupId?:     number | null
}

const snippetSelect = {
  id: true, name: true, command: true, description: true,
  scope: true, groupId: true, createdAt: true, updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  group: { select: { id: true, name: true, scope: true } },
} as const

export class SnippetService {
  constructor(
    private readonly db: PrismaClient,
    private readonly entitlements: LicenseEntitlementService,
  ) {}

  /** Lista snippets acessíveis pelo usuário:
   *  - seus próprios snippets pessoais
   *  - todos os snippets TEAM do tenant
   */
  async list(userId: number, tenantId: number) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    return this.db.snippet.findMany({
      where: {
        tenantId,
        OR: [
          { scope: 'TEAM' },
          { scope: 'PERSONAL', createdById: userId },
        ],
      },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
      select: snippetSelect,
    })
  }

  async create(userId: number, tenantId: number, dto: CreateSnippetDto) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    if (dto.groupId != null) {
      await this.assertGroupVisible(dto.groupId, userId, tenantId)
    }

    return this.db.snippet.create({
      data: {
        tenantId,
        createdById: userId,
        name:        dto.name,
        command:     dto.command,
        scope:       dto.scope,
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.groupId     !== undefined && { groupId:     dto.groupId }),
      },
      select: snippetSelect,
    })
  }

  async update(id: number, userId: number, tenantId: number, dto: UpdateSnippetDto) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    const snippet = await this.db.snippet.findFirst({ where: { id, tenantId } })
    if (!snippet) throw new AppError('Snippet não encontrado', 404, 'SNIPPET_NOT_FOUND')
    if (snippet.createdById !== userId) throw new AppError('Sem permissão para editar este snippet', 403, 'SNIPPET_FORBIDDEN')

    if (dto.groupId != null) {
      await this.assertGroupVisible(dto.groupId, userId, tenantId)
    }

    return this.db.snippet.update({
      where: { id },
      data: {
        ...(dto.name        !== undefined && { name:        dto.name }),
        ...(dto.command     !== undefined && { command:     dto.command }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.scope       !== undefined && { scope:       dto.scope }),
        // groupId: null é intencional para desvinculação — usar hasOwnProperty
        ...(Object.prototype.hasOwnProperty.call(dto, 'groupId') && { groupId: dto.groupId ?? null }),
      },
      select: snippetSelect,
    })
  }

  async remove(id: number, userId: number, tenantId: number) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    const snippet = await this.db.snippet.findFirst({ where: { id, tenantId } })
    if (!snippet) throw new AppError('Snippet não encontrado', 404, 'SNIPPET_NOT_FOUND')
    if (snippet.createdById !== userId) throw new AppError('Sem permissão para excluir este snippet', 403, 'SNIPPET_FORBIDDEN')
    await this.db.snippet.delete({ where: { id } })
  }

  /** Garante que o grupo existe e é visível para o usuário (TEAM ou do próprio usuário) */
  private async assertGroupVisible(groupId: number, userId: number, tenantId: number) {
    const group = await this.db.snippetGroup.findFirst({
      where: {
        id: groupId,
        tenantId,
        OR: [
          { scope: 'TEAM' },
          { scope: 'PERSONAL', createdById: userId },
        ],
      },
    })
    if (!group) throw new AppError('Grupo de snippets não encontrado ou sem acesso', 404, 'SNIPPET_GROUP_NOT_FOUND')
  }
}
