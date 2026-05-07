import type {
  CreateLocalAiKnowledgeLinkDocumentDto,
  CreateLocalAiKnowledgeTextDocumentDto,
  LocalAiKnowledgeDocument,
} from '@nodeaccess/shared'
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js'
import type { JwtPayload } from '../../shared/guards.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { LocalAiKnowledgeDocumentRow, LocalAiKnowledgeRepository } from './local-ai-knowledge.repository.js'

const TEXTUAL_MIME_PREFIXES = ['text/']
const TEXTUAL_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
])
const TEXTUAL_EXTENSIONS = new Set(['txt', 'md', 'log', 'json', 'yaml', 'yml', 'csv', 'conf', 'ini'])

export class LocalAiKnowledgeService {
  constructor(
    private readonly repo: LocalAiKnowledgeRepository,
    private readonly entitlements: LicenseEntitlementService,
    private readonly logRepo: LogRepository,
  ) {}

  async listAdminDocuments(user: JwtPayload): Promise<LocalAiKnowledgeDocument[]> {
    this.ensureAdmin(user)
    await this.ensureLicensed(user.tenantId)
    const rows = await this.repo.listByTenant(user.tenantId)
    return rows.map(mapDocument)
  }

  async createTextDocument(user: JwtPayload, input: CreateLocalAiKnowledgeTextDocumentDto): Promise<LocalAiKnowledgeDocument> {
    this.ensureAdmin(user)
    await this.ensureLicensed(user.tenantId)

    const row = await this.repo.create({
      tenantId: user.tenantId,
      createdByUserId: Number(user.sub),
      sourceType: 'TEXT',
      status: 'READY',
      title: input.title.trim(),
      description: normalizeText(input.description),
      contentText: input.contentText.trim(),
    })

    await this.logRepo.logAdminEvent({
      adminId: Number(user.sub),
      action: 'CREATE_LOCAL_AI_KNOWLEDGE_DOCUMENT',
      targetType: 'LocalAiKnowledgeDocument',
      targetId: row.id,
      details: JSON.stringify({ sourceType: row.sourceType, title: row.title }),
    }).catch(() => { /* best-effort */ })

    return mapDocument(row)
  }

  async createLinkDocument(user: JwtPayload, input: CreateLocalAiKnowledgeLinkDocumentDto): Promise<LocalAiKnowledgeDocument> {
    this.ensureAdmin(user)
    await this.ensureLicensed(user.tenantId)

    const row = await this.repo.create({
      tenantId: user.tenantId,
      createdByUserId: Number(user.sub),
      sourceType: 'LINK',
      status: 'READY',
      title: input.title.trim(),
      description: normalizeText(input.description),
      referenceUrl: input.referenceUrl.trim(),
      contentText: normalizeText(input.contentText),
    })

    await this.logRepo.logAdminEvent({
      adminId: Number(user.sub),
      action: 'CREATE_LOCAL_AI_KNOWLEDGE_DOCUMENT',
      targetType: 'LocalAiKnowledgeDocument',
      targetId: row.id,
      details: JSON.stringify({ sourceType: row.sourceType, title: row.title, referenceUrl: row.referenceUrl }),
    }).catch(() => { /* best-effort */ })

    return mapDocument(row)
  }

  async createFileDocument(user: JwtPayload, input: {
    fileName: string
    mimeType: string | null
    byteSize: number
    contentText: string
  }): Promise<LocalAiKnowledgeDocument> {
    this.ensureAdmin(user)
    await this.ensureLicensed(user.tenantId)

    const fileName = input.fileName.trim()
    if (!fileName) throw new ValidationError('Nome do arquivo inválido')
    if (!input.contentText.trim()) throw new ValidationError('Arquivo sem conteúdo textual aproveitável')
    if (!isTextualFile(fileName, input.mimeType)) {
      throw new ValidationError('Somente arquivos textuais são suportados nesta fase da base de conhecimento')
    }

    const row = await this.repo.create({
      tenantId: user.tenantId,
      createdByUserId: Number(user.sub),
      sourceType: 'FILE',
      status: 'READY',
      title: fileName,
      fileName,
      mimeType: input.mimeType ?? 'text/plain',
      byteSize: input.byteSize,
      contentText: input.contentText.trim(),
    })

    await this.logRepo.logAdminEvent({
      adminId: Number(user.sub),
      action: 'CREATE_LOCAL_AI_KNOWLEDGE_DOCUMENT',
      targetType: 'LocalAiKnowledgeDocument',
      targetId: row.id,
      details: JSON.stringify({ sourceType: row.sourceType, title: row.title, mimeType: row.mimeType, byteSize: row.byteSize }),
    }).catch(() => { /* best-effort */ })

    return mapDocument(row)
  }

  async deleteDocument(user: JwtPayload, id: number): Promise<void> {
    this.ensureAdmin(user)
    await this.ensureLicensed(user.tenantId)

    const row = await this.repo.findById(user.tenantId, id)
    if (!row || row.deletedAt) throw new NotFoundError('Documento')

    await this.repo.softDelete(user.tenantId, id)
    await this.logRepo.logAdminEvent({
      adminId: Number(user.sub),
      action: 'DELETE_LOCAL_AI_KNOWLEDGE_DOCUMENT',
      targetType: 'LocalAiKnowledgeDocument',
      targetId: row.id,
      details: JSON.stringify({ sourceType: row.sourceType, title: row.title }),
    }).catch(() => { /* best-effort */ })
  }

  private ensureAdmin(user: JwtPayload): void {
    if (user.role !== 'admin') {
      throw new ForbiddenError('Apenas administradores podem gerenciar a base de conhecimento da IA')
    }
  }

  private async ensureLicensed(tenantId: number): Promise<void> {
    await this.entitlements.requireFeature(
      tenantId,
      'localAi',
      'Assistente local não licenciado para este tenant',
    )
  }
}

function mapDocument(row: LocalAiKnowledgeDocumentRow): LocalAiKnowledgeDocument {
  return {
    id: row.id,
    sourceType: row.sourceType.toLowerCase() as LocalAiKnowledgeDocument['sourceType'],
    status: row.status.toLowerCase() as LocalAiKnowledgeDocument['status'],
    title: row.title,
    description: row.description,
    referenceUrl: row.referenceUrl,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    hasContent: !!row.contentText?.trim(),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
  }
}

function normalizeText(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function isTextualFile(fileName: string, mimeType: string | null): boolean {
  const mime = mimeType?.toLowerCase() ?? ''
  if (TEXTUAL_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) return true
  if (mime && TEXTUAL_MIME_TYPES.has(mime)) return true

  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return TEXTUAL_EXTENSIONS.has(extension)
}
