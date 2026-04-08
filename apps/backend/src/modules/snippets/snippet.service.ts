import type { PrismaClient, SnippetScope } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'

export interface CreateSnippetDto {
  name:        string
  command:     string
  description?: string
  scope:       SnippetScope
}

export interface UpdateSnippetDto {
  name?:        string
  command?:     string
  description?: string
  scope?:       SnippetScope
}

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
      select: {
        id: true, name: true, command: true, description: true,
        scope: true, createdAt: true, updatedAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    })
  }

  async create(userId: number, tenantId: number, dto: CreateSnippetDto) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    return this.db.snippet.create({
      data: {
        tenantId,
        createdById: userId,
        name:        dto.name,
        command:     dto.command,
        scope:       dto.scope,
        ...(dto.description !== undefined && { description: dto.description }),
      },
    })
  }

  async update(id: number, userId: number, tenantId: number, dto: UpdateSnippetDto) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    const snippet = await this.db.snippet.findFirst({ where: { id, tenantId } })
    if (!snippet) throw new AppError('Snippet não encontrado', 404, 'SNIPPET_NOT_FOUND')
    if (snippet.createdById !== userId) throw new AppError('Sem permissão para editar este snippet', 403, 'SNIPPET_FORBIDDEN')

    return this.db.snippet.update({
      where: { id },
      data: {
        ...(dto.name        !== undefined && { name:        dto.name }),
        ...(dto.command     !== undefined && { command:     dto.command }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.scope       !== undefined && { scope:       dto.scope }),
      },
    })
  }

  async remove(id: number, userId: number, tenantId: number) {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    const snippet = await this.db.snippet.findFirst({ where: { id, tenantId } })
    if (!snippet) throw new AppError('Snippet não encontrado', 404, 'SNIPPET_NOT_FOUND')
    if (snippet.createdById !== userId) throw new AppError('Sem permissão para excluir este snippet', 403, 'SNIPPET_FORBIDDEN')
    await this.db.snippet.delete({ where: { id } })
  }
}
