import { Prisma, type PrismaClient } from '@prisma/client'
import type { AiScriptArtifactDetail } from '@nodeaccess/shared'

type Row = Omit<AiScriptArtifactDetail, 'status' | 'risk'> & { status: string; risk: string }

export class AiScriptArtifactRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: {
    tenantId: number; hostId: number; createdById: number; title: string; objective: string
    content: string; checksum: string; risk: 'safe' | 'approval_required'; interactionCorrelationId?: string | null
  }): Promise<AiScriptArtifactDetail> {
    const id = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO ai_script_artifacts (
          tenant_id, host_id, created_by_id, title, objective, destination,
          content, checksum, status, risk, interaction_correlation_id, created_at, updated_at
        ) VALUES (
          ${input.tenantId}, ${input.hostId}, ${input.createdById}, ${input.title}, ${input.objective},
          ${'/tmp/pending'}, ${input.content}, ${input.checksum}, ${'draft'}, ${input.risk}, ${input.interactionCorrelationId ?? null}, NOW(), NOW()
        )
      `)
      const rows = await tx.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`SELECT LAST_INSERT_ID() AS id`)
      const artifactId = Number(rows[0]?.id)
      await tx.$executeRaw(Prisma.sql`
        UPDATE ai_script_artifacts SET destination = ${`/tmp/nodeaccess-ai-script-${artifactId}.sh`} WHERE id = ${artifactId}
      `)
      return artifactId
    })
    const artifact = await this.findById(id, input.tenantId)
    if (!artifact) throw new Error('Falha ao carregar o artefato de script criado')
    return artifact
  }

  async findById(id: number, tenantId: number): Promise<AiScriptArtifactDetail | null> {
    const rows = await this.db.$queryRaw<Row[]>(Prisma.sql`
      SELECT id, tenant_id AS tenantId, host_id AS hostId, created_by_id AS createdById,
        action_run_id AS actionRunId, interaction_correlation_id AS interactionCorrelationId, title, objective, destination, content, checksum,
        LOWER(status) AS status, LOWER(risk) AS risk, created_at AS createdAt, updated_at AS updatedAt
      FROM ai_script_artifacts WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
    `)
    const row = rows[0]
    if (!row) return null
    return {
      ...row,
      status: row.status as AiScriptArtifactDetail['status'],
      risk: row.risk as AiScriptArtifactDetail['risk'],
    }
  }

  async linkActionRun(id: number, tenantId: number, actionRunId: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE ai_script_artifacts SET action_run_id = ${actionRunId}, status = ${'pending_approval'}, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND action_run_id IS NULL
    `)
  }

  async updateFromRun(id: number, tenantId: number, status: 'approved' | 'executed' | 'failed' | 'rejected'): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE ai_script_artifacts SET status = ${status}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}
    `)
  }
}
