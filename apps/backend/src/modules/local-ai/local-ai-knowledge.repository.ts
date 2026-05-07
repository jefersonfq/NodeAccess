import type { PrismaClient } from '@prisma/client'

export interface LocalAiKnowledgeDocumentRow {
  id: number
  tenantId: number
  createdByUserId: number
  sourceType: 'TEXT' | 'LINK' | 'FILE'
  status: 'READY' | 'FAILED'
  title: string
  description: string | null
  referenceUrl: string | null
  fileName: string | null
  mimeType: string | null
  byteSize: number | null
  contentText: string | null
  errorMessage: string | null
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdBy: { id: number; name: string; email: string }
}

interface CreateDocumentInput {
  tenantId: number
  createdByUserId: number
  sourceType: 'TEXT' | 'LINK' | 'FILE'
  status: 'READY' | 'FAILED'
  title: string
  description?: string | null
  referenceUrl?: string | null
  fileName?: string | null
  mimeType?: string | null
  byteSize?: number | null
  contentText?: string | null
  errorMessage?: string | null
}

export class LocalAiKnowledgeRepository {
  constructor(private readonly db: PrismaClient) {}

  async listByTenant(tenantId: number): Promise<LocalAiKnowledgeDocumentRow[]> {
    const rows = await this.db.$queryRaw<Array<RawDocumentRow>>`
      SELECT
        d.id,
        d.tenant_id AS tenantId,
        d.created_by_user_id AS createdByUserId,
        d.source_type AS sourceType,
        d.status,
        d.title,
        d.description,
        d.reference_url AS referenceUrl,
        d.file_name AS fileName,
        d.mime_type AS mimeType,
        d.byte_size AS byteSize,
        d.content_text AS contentText,
        d.error_message AS errorMessage,
        d.deleted_at AS deletedAt,
        d.created_at AS createdAt,
        d.updated_at AS updatedAt,
        u.id AS createdById,
        u.name AS createdByName,
        u.email AS createdByEmail
      FROM local_ai_knowledge_documents d
      INNER JOIN users u ON u.id = d.created_by_user_id
      WHERE d.tenant_id = ${tenantId} AND d.deleted_at IS NULL
      ORDER BY d.created_at DESC
    `

    return rows.map(mapRow)
  }

  async create(data: CreateDocumentInput): Promise<LocalAiKnowledgeDocumentRow> {
    await this.db.$executeRaw`
      INSERT INTO local_ai_knowledge_documents (
        tenant_id,
        created_by_user_id,
        source_type,
        status,
        title,
        description,
        reference_url,
        file_name,
        mime_type,
        byte_size,
        content_text,
        error_message,
        created_at,
        updated_at
      ) VALUES (
        ${data.tenantId},
        ${data.createdByUserId},
        ${data.sourceType},
        ${data.status},
        ${data.title},
        ${data.description ?? null},
        ${data.referenceUrl ?? null},
        ${data.fileName ?? null},
        ${data.mimeType ?? null},
        ${data.byteSize ?? null},
        ${data.contentText ?? null},
        ${data.errorMessage ?? null},
        NOW(),
        NOW()
      )
    `

    const [row] = await this.db.$queryRaw<Array<RawDocumentRow>>`
      SELECT
        d.id,
        d.tenant_id AS tenantId,
        d.created_by_user_id AS createdByUserId,
        d.source_type AS sourceType,
        d.status,
        d.title,
        d.description,
        d.reference_url AS referenceUrl,
        d.file_name AS fileName,
        d.mime_type AS mimeType,
        d.byte_size AS byteSize,
        d.content_text AS contentText,
        d.error_message AS errorMessage,
        d.deleted_at AS deletedAt,
        d.created_at AS createdAt,
        d.updated_at AS updatedAt,
        u.id AS createdById,
        u.name AS createdByName,
        u.email AS createdByEmail
      FROM local_ai_knowledge_documents d
      INNER JOIN users u ON u.id = d.created_by_user_id
      WHERE d.tenant_id = ${data.tenantId}
      ORDER BY d.id DESC
      LIMIT 1
    `

    if (!row) {
      throw new Error('Falha ao recarregar documento recém-criado da base de conhecimento')
    }

    return mapRow(row)
  }

  async findById(tenantId: number, id: number): Promise<LocalAiKnowledgeDocumentRow | null> {
    const [row] = await this.db.$queryRaw<Array<RawDocumentRow>>`
      SELECT
        d.id,
        d.tenant_id AS tenantId,
        d.created_by_user_id AS createdByUserId,
        d.source_type AS sourceType,
        d.status,
        d.title,
        d.description,
        d.reference_url AS referenceUrl,
        d.file_name AS fileName,
        d.mime_type AS mimeType,
        d.byte_size AS byteSize,
        d.content_text AS contentText,
        d.error_message AS errorMessage,
        d.deleted_at AS deletedAt,
        d.created_at AS createdAt,
        d.updated_at AS updatedAt,
        u.id AS createdById,
        u.name AS createdByName,
        u.email AS createdByEmail
      FROM local_ai_knowledge_documents d
      INNER JOIN users u ON u.id = d.created_by_user_id
      WHERE d.tenant_id = ${tenantId} AND d.id = ${id}
      LIMIT 1
    `

    return row ? mapRow(row) : null
  }

  async softDelete(tenantId: number, id: number): Promise<void> {
    await this.db.$executeRaw`
      UPDATE local_ai_knowledge_documents
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    `
  }

  async searchReadyDocuments(tenantId: number, query: string, limit: number): Promise<Array<{
    id: number
    title: string
    sourceType: 'TEXT' | 'LINK' | 'FILE'
    referenceUrl: string | null
    excerpt: string | null
  }>> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const like = `%${trimmed}%`
    const rows = await this.db.$queryRaw<Array<{
      id: number
      title: string
      sourceType: 'TEXT' | 'LINK' | 'FILE'
      referenceUrl: string | null
      contentText: string | null
      description: string | null
    }>>`
      SELECT
        id,
        title,
        source_type AS sourceType,
        reference_url AS referenceUrl,
        content_text AS contentText,
        description
      FROM local_ai_knowledge_documents
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND status = 'READY'
        AND (
          title LIKE ${like}
          OR description LIKE ${like}
          OR reference_url LIKE ${like}
          OR content_text LIKE ${like}
        )
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      sourceType: row.sourceType,
      referenceUrl: row.referenceUrl,
      excerpt: buildExcerpt(row.contentText, row.description, trimmed),
    }))
  }
}

interface RawDocumentRow {
  id: number
  tenantId: number
  createdByUserId: number
  sourceType: 'TEXT' | 'LINK' | 'FILE'
  status: 'READY' | 'FAILED'
  title: string
  description: string | null
  referenceUrl: string | null
  fileName: string | null
  mimeType: string | null
  byteSize: number | null
  contentText: string | null
  errorMessage: string | null
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdById: number
  createdByName: string
  createdByEmail: string
}

function mapRow(row: RawDocumentRow): LocalAiKnowledgeDocumentRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    createdByUserId: row.createdByUserId,
    sourceType: row.sourceType,
    status: row.status,
    title: row.title,
    description: row.description,
    referenceUrl: row.referenceUrl,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    contentText: row.contentText,
    errorMessage: row.errorMessage,
    deletedAt: row.deletedAt,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    createdBy: {
      id: row.createdById,
      name: row.createdByName,
      email: row.createdByEmail,
    },
  }
}

function buildExcerpt(contentText: string | null, description: string | null, query: string): string | null {
  const source = contentText?.trim() || description?.trim()
  if (!source) return null
  const lower = source.toLowerCase()
  const index = lower.indexOf(query.toLowerCase())
  if (index < 0) return source.slice(0, 220)
  const start = Math.max(0, index - 80)
  const end = Math.min(source.length, index + query.length + 140)
  return source.slice(start, end)
}
