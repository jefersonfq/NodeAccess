import { Prisma, type PrismaClient } from '@prisma/client'
import type { CompleteAiInvestigationDto } from '@nodeaccess/shared'

export class AiInvestigationRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: { tenantId: number; hostId: number; userId: number; tokenId?: number | null; objective: string; expiresAt: Date }) {
    await this.db.$executeRaw(Prisma.sql`INSERT INTO ai_investigations (tenant_id,host_id,requested_by_id,mcp_token_id,objective,status,expires_at,last_activity_at,created_at,updated_at) VALUES (${input.tenantId},${input.hostId},${input.userId},${input.tokenId ?? null},${input.objective},'OPEN',${input.expiresAt},NOW(3),NOW(3),NOW(3))`)
    const rows = await this.db.$queryRaw<Array<{ id: bigint | number }>>(Prisma.sql`SELECT LAST_INSERT_ID() id`)
    return Number(rows[0]?.id)
  }

  async find(id: number, tenantId: number) {
    const rows = await this.db.$queryRaw<any[]>(Prisma.sql`
      SELECT i.id,i.tenant_id tenantId,i.host_id hostId,h.name hostName,h.ip hostIp,i.requested_by_id requestedById,u.name requestedByName,
        i.mcp_token_id mcpTokenId,t.name mcpTokenName,i.objective,i.status,i.expires_at expiresAt,i.last_activity_at lastActivityAt,
        i.closed_at closedAt,i.close_reason closeReason,i.created_at createdAt
      FROM ai_investigations i JOIN hosts h ON h.id=i.host_id JOIN users u ON u.id=i.requested_by_id
      LEFT JOIN mcp_tokens t ON t.id=i.mcp_token_id WHERE i.id=${id} AND i.tenant_id=${tenantId} LIMIT 1`)
    return rows[0] ?? null
  }

  async list(tenantId: number, limit = 50) {
    return this.db.$queryRaw<any[]>(Prisma.sql`
      SELECT i.id,i.tenant_id tenantId,i.host_id hostId,h.name hostName,h.ip hostIp,i.requested_by_id requestedById,u.name requestedByName,
        i.mcp_token_id mcpTokenId,t.name mcpTokenName,i.objective,i.status,i.expires_at expiresAt,i.last_activity_at lastActivityAt,
        i.closed_at closedAt,i.close_reason closeReason,i.created_at createdAt,
        (SELECT COUNT(*) FROM ai_ssh_action_runs r WHERE r.investigation_id=i.id) actionRunCount
      FROM ai_investigations i JOIN hosts h ON h.id=i.host_id JOIN users u ON u.id=i.requested_by_id LEFT JOIN mcp_tokens t ON t.id=i.mcp_token_id
      WHERE i.tenant_id=${tenantId} ORDER BY i.last_activity_at DESC LIMIT ${Math.min(100, Math.max(1, limit))}`)
  }

  async actionRuns(id: number, tenantId: number) {
    return this.db.$queryRaw<any[]>(Prisma.sql`SELECT id,tenant_id tenantId,host_id hostId,requested_by_id requestedById,approved_by_id approvedById,LOWER(channel) channel,LOWER(mode) mode,LOWER(status) status,summary,approval_reason approvalReason,error_message errorMessage,started_at startedAt,finished_at finishedAt,created_at createdAt,updated_at updatedAt,script_artifact_id scriptArtifactId,mcp_token_id mcpTokenId,investigation_id investigationId FROM ai_ssh_action_runs WHERE investigation_id=${id} AND tenant_id=${tenantId} ORDER BY created_at`)
  }

  async reports(id: number) {
    const rows = await this.db.$queryRaw<any[]>(Prisma.sql`SELECT id,investigation_id investigationId,created_by_id createdById,provider,model,summary,facts_json facts,hypotheses_json hypotheses,risks_json risks,recommendations_json recommendations,actions_json actions,evidence_json evidence,redaction_applied redactionApplied,checksum,created_at createdAt FROM ai_investigation_reports WHERE investigation_id=${id} ORDER BY created_at DESC`)
    return rows.map((row) => ({ ...row, facts: json(row.facts), hypotheses: json(row.hypotheses), risks: json(row.risks), recommendations: json(row.recommendations), actions: json(row.actions), evidence: json(row.evidence), redactionApplied: !!row.redactionApplied }))
  }

  async attachRun(id: number, runId: number, tenantId: number) {
    return this.db.$executeRaw(Prisma.sql`UPDATE ai_ssh_action_runs SET investigation_id=${id} WHERE id=${runId} AND tenant_id=${tenantId}`)
  }
  async touch(id: number, tenantId: number, status: 'OPEN' | 'WAITING_USER' = 'OPEN') {
    return this.db.$executeRaw(Prisma.sql`UPDATE ai_investigations SET status=${status},last_activity_at=NOW(3),updated_at=NOW(3) WHERE id=${id} AND tenant_id=${tenantId} AND status IN ('OPEN','WAITING_USER')`)
  }
  async addReport(input: { investigationId: number; userId: number; dto: CompleteAiInvestigationDto; sanitized: Record<string, any>; checksum: string; redactionApplied: boolean }) {
    const s = input.sanitized
    await this.db.$executeRaw(Prisma.sql`INSERT INTO ai_investigation_reports (investigation_id,created_by_id,provider,model,summary,facts_json,hypotheses_json,risks_json,recommendations_json,actions_json,evidence_json,redaction_applied,checksum,created_at) VALUES (${input.investigationId},${input.userId},${input.dto.provider ?? null},${input.dto.model ?? null},${s.summary},${JSON.stringify(s.facts)},${JSON.stringify(s.hypotheses)},${JSON.stringify(s.risks)},${JSON.stringify(s.recommendations)},${JSON.stringify(s.actions)},${JSON.stringify(input.dto.evidence)},${input.redactionApplied},${input.checksum},NOW(3))`)
  }
  async close(id: number, tenantId: number, status: 'COMPLETED' | 'ABANDONED', reason: string) {
    return this.db.$executeRaw(Prisma.sql`UPDATE ai_investigations SET status=${status},close_reason=${reason},closed_at=NOW(3),last_activity_at=NOW(3),updated_at=NOW(3) WHERE id=${id} AND tenant_id=${tenantId} AND status IN ('OPEN','WAITING_USER')`)
  }
  async expire(now = new Date()) { return this.db.$executeRaw(Prisma.sql`UPDATE ai_investigations SET status='ABANDONED',close_reason='ttl_expired',closed_at=${now},updated_at=${now} WHERE status IN ('OPEN','WAITING_USER') AND expires_at<${now}`) }
}
function json(value: unknown): any[] { if (Array.isArray(value)) return value; try { return JSON.parse(String(value ?? '[]')) } catch { return [] } }
