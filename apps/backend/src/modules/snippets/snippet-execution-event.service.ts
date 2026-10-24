import type { PrismaClient } from '@prisma/client'

export type SnippetExecutionSource = 'TERMINAL' | 'MCP' | 'API'
export type SnippetExecutionStatus = 'SENT' | 'FAILED_SECRET_RESOLUTION' | 'BLOCKED'

export interface RecordSnippetExecutionInput {
  tenantId: number
  userId: number
  snippetId: number
  executionId: string
  source: SnippetExecutionSource
  status: SnippetExecutionStatus
  hostId?: number
  sessionId?: number
  metadata?: Record<string, unknown> | undefined
}

export class SnippetExecutionEventService {
  constructor(private readonly db: PrismaClient) {}

  async record(input: RecordSnippetExecutionInput): Promise<void> {
    if (!Number.isInteger(input.snippetId) || input.snippetId <= 0) return
    if (!input.executionId || input.executionId.length > 64) return

    const metadataJson = input.metadata === undefined ? null : JSON.stringify(input.metadata)

    await this.db.$executeRaw`
      INSERT INTO snippet_execution_events (
        tenant_id,
        user_id,
        snippet_id,
        host_id,
        session_id,
        execution_id,
        source,
        status,
        metadata_json
      )
      SELECT
        ${input.tenantId},
        ${input.userId},
        s.id,
        ${input.hostId ?? null},
        ${input.sessionId ?? null},
        ${input.executionId},
        ${input.source},
        ${input.status},
        ${metadataJson}
      FROM snippets s
      WHERE s.id = ${input.snippetId}
        AND s.tenant_id = ${input.tenantId}
      LIMIT 1
      ON DUPLICATE KEY UPDATE
        status = IF(user_id = VALUES(user_id) AND snippet_id = VALUES(snippet_id) AND VALUES(status) = 'FAILED_SECRET_RESOLUTION', VALUES(status), status),
        host_id = IF(user_id = VALUES(user_id) AND snippet_id = VALUES(snippet_id), COALESCE(VALUES(host_id), host_id), host_id),
        session_id = IF(user_id = VALUES(user_id) AND snippet_id = VALUES(snippet_id), COALESCE(VALUES(session_id), session_id), session_id),
        metadata_json = CASE WHEN user_id <> VALUES(user_id) OR snippet_id IS NULL OR snippet_id <> VALUES(snippet_id) OR VALUES(metadata_json) IS NULL THEN metadata_json ELSE JSON_MERGE_PATCH(COALESCE(metadata_json, JSON_OBJECT()), VALUES(metadata_json)) END
    `
  }
}
