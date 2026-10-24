import { validateSnippetCommand, type MacroOutcome } from '@nodeaccess/shared'
import type { PrismaClient, SnippetScope, Prisma } from '@prisma/client'
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

type SelectedSnippet = Prisma.SnippetGetPayload<{ select: typeof snippetSelect }>

export class SnippetService {
  constructor(
    private readonly db: PrismaClient,
    private readonly entitlements: LicenseEntitlementService,
  ) {}

  private validate(dto: UpdateSnippetDto): void {
    if ((dto.name !== undefined && !dto.name.trim()) || (dto.command !== undefined && !validateSnippetCommand(dto.command))) throw new AppError('Snippet inválido: revise os passos da macro', 400, 'SNIPPET_INVALID')
  }

  async recordOutcome(userId: number, tenantId: number, snippetId: number, outcome: MacroOutcome): Promise<boolean> {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')
    // Client progress only enriches existing events owned by this user.
    const { executionId, ...progress } = outcome
    const count = await this.db.$executeRaw`
      UPDATE snippet_execution_events SET metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.macro', JSON_EXTRACT(${JSON.stringify(progress)}, '$'))
      WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND snippet_id = ${snippetId} AND execution_id = ${executionId}
    `
    return count > 0
  }

  /** Lista snippets acessíveis pelo usuário:
   *  - seus próprios snippets pessoais
   *  - todos os snippets TEAM do tenant
   */
  async list(userId: number, tenantId: number): Promise<SelectedSnippet[]> {
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

  async create(userId: number, tenantId: number, dto: CreateSnippetDto): Promise<SelectedSnippet> {
    this.validate(dto)
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

  async update(id: number, userId: number, tenantId: number, dto: UpdateSnippetDto): Promise<SelectedSnippet> {
    this.validate(dto)
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

  async remove(id: number, userId: number, tenantId: number): Promise<void> {
    await this.entitlements.requireFeature(tenantId, 'snippets', 'Snippets não licenciados para este tenant')

    const snippet = await this.db.snippet.findFirst({ where: { id, tenantId } })
    if (!snippet) throw new AppError('Snippet não encontrado', 404, 'SNIPPET_NOT_FOUND')
    if (snippet.createdById !== userId) throw new AppError('Sem permissão para excluir este snippet', 403, 'SNIPPET_FORBIDDEN')
    await this.db.snippet.delete({ where: { id } })
  }

  /** Garante que o grupo existe e é visível para o usuário (TEAM ou do próprio usuário) */
  private async assertGroupVisible(groupId: number, userId: number, tenantId: number): Promise<void> {
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
