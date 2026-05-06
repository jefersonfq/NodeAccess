import { Prisma, type PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'

export interface SessionAuditAiJobRow {
  id: number
  sessionId: number
  tenantId: number
  requestedByUserId: number | null
  kind: 'SUMMARY'
  triggerSource: 'AUTO_POST_SESSION' | 'MANUAL' | 'WINDOW'
  provider: string
  model: string | null
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'CANCELED'
  promptVersion: string | null
  errorMessage: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface SessionAuditAiArtifactRow {
  id: number
  sessionId: number
  jobId: number
  triggerSource: 'AUTO_POST_SESSION' | 'MANUAL' | 'WINDOW'
  template: string
  summaryText: string
  summaryJson: string
  riskLevel: string | null
  createdAt: Date
}

export class SessionAuditAiRepository {
  private warnedMissingTable = false

  constructor(private readonly db: PrismaClient) {}

  async enqueueAutoSummaryJob(input: {
    sessionId: number
    tenantId: number
    provider: string
    model?: string | null
    promptVersion?: string | null
  }): Promise<boolean> {
    try {
      const affected = await this.db.$transaction(async (tx) => {
        const existing = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT j.id
          FROM session_audit_ai_jobs j
          INNER JOIN session_audits sa ON sa.id = j.session_audit_id
          WHERE sa.session_id = ${input.sessionId}
            AND sa.tenant_id = ${input.tenantId}
            AND j.kind = ${'SUMMARY'}
            AND j.trigger_source = ${'AUTO_POST_SESSION'}
          LIMIT 1
        `)

        if (existing.length > 0) {
          return 0
        }

        const inserted = await tx.$executeRaw(Prisma.sql`
          INSERT INTO session_audit_ai_jobs (
            session_audit_id,
            tenant_id,
            requested_by_user_id,
            kind,
            trigger_source,
            provider,
            model,
            status,
            prompt_version,
            created_at,
            updated_at
          )
          SELECT
            sa.id,
            sa.tenant_id,
            NULL,
            ${'SUMMARY'},
            ${'AUTO_POST_SESSION'},
            ${input.provider},
            ${input.model ?? null},
            ${'PENDING'},
            ${input.promptVersion ?? 'v1'},
            NOW(),
            NOW()
          FROM session_audits sa
          WHERE sa.session_id = ${input.sessionId}
            AND sa.tenant_id = ${input.tenantId}
            AND sa.status = ${'COMPLETED'}
        `)

        if (inserted > 0) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE session_audits
            SET
              ai_summary_status = ${'PENDING'},
              updated_at = NOW()
            WHERE session_id = ${input.sessionId}
          `)
        }

        return inserted
      })

      return affected > 0
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit AI job enqueue failed')
      return false
    }
  }

  async listPendingSummaryJobs(limit = 20): Promise<SessionAuditAiJobRow[]> {
    try {
      return await this.db.$queryRaw<SessionAuditAiJobRow[]>(Prisma.sql`
        SELECT
          j.id,
          sa.session_id AS sessionId,
          j.tenant_id AS tenantId,
          j.requested_by_user_id AS requestedByUserId,
          j.kind,
          j.trigger_source AS triggerSource,
          j.provider,
          j.model,
          j.status,
          j.prompt_version AS promptVersion,
          j.error_message AS errorMessage,
          j.started_at AS startedAt,
          j.finished_at AS finishedAt,
          j.created_at AS createdAt,
          j.updated_at AS updatedAt
        FROM session_audit_ai_jobs j
        INNER JOIN session_audits sa ON sa.id = j.session_audit_id
        WHERE j.kind = ${'SUMMARY'}
          AND j.status = ${'PENDING'}
        ORDER BY j.created_at ASC
        LIMIT ${limit}
      `)
    } catch (err) {
      if (isTableMissingError(err)) return []
      logger.error({ err }, 'Session audit AI jobs pending query failed')
      return []
    }
  }

  async requeueStaleProcessingJobs(staleBefore: Date): Promise<number> {
    try {
      const affected = await this.db.$transaction(async (tx) => {
        const jobs = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT id
          FROM session_audit_ai_jobs
          WHERE kind = ${'SUMMARY'}
            AND status = ${'PROCESSING'}
            AND started_at IS NOT NULL
            AND started_at < ${staleBefore}
        `)

        if (jobs.length === 0) return 0

        const jobIds = jobs.map((job) => job.id)
        await tx.$executeRaw(Prisma.sql`
          UPDATE session_audit_ai_jobs
          SET
            status = ${'PENDING'},
            error_message = ${'Job reencaminhado após exceder o timeout de processamento'},
            started_at = NULL,
            updated_at = NOW()
          WHERE id IN (${Prisma.join(jobIds)})
        `)

        await tx.$executeRaw(Prisma.sql`
          UPDATE session_audits sa
          INNER JOIN session_audit_ai_jobs j ON j.session_audit_id = sa.id
          SET
            sa.ai_summary_status = ${'PENDING'},
            sa.updated_at = NOW()
          WHERE j.id IN (${Prisma.join(jobIds)})
        `)

        return jobIds.length
      })

      return affected
    } catch (err) {
      if (isTableMissingError(err)) return 0
      logger.error({ err }, 'Session audit AI stale job requeue failed')
      return 0
    }
  }

  async listBySessionId(tenantId: number, sessionId: number): Promise<SessionAuditAiJobRow[]> {
    try {
      return await this.db.$queryRaw<SessionAuditAiJobRow[]>(Prisma.sql`
        SELECT
          j.id,
          sa.session_id AS sessionId,
          j.tenant_id AS tenantId,
          j.requested_by_user_id AS requestedByUserId,
          j.kind,
          j.trigger_source AS triggerSource,
          j.provider,
          j.model,
          j.status,
          j.prompt_version AS promptVersion,
          j.error_message AS errorMessage,
          j.started_at AS startedAt,
          j.finished_at AS finishedAt,
          j.created_at AS createdAt,
          j.updated_at AS updatedAt
        FROM session_audit_ai_jobs j
        INNER JOIN session_audits sa ON sa.id = j.session_audit_id
        WHERE sa.tenant_id = ${tenantId}
          AND sa.session_id = ${sessionId}
        ORDER BY j.created_at DESC
      `)
    } catch (err) {
      if (isTableMissingError(err)) return []
      logger.error({ err }, 'Session audit AI jobs by session query failed')
      return []
    }
  }

  async listArtifactsBySessionId(tenantId: number, sessionId: number): Promise<SessionAuditAiArtifactRow[]> {
    try {
      return await this.db.$queryRaw<SessionAuditAiArtifactRow[]>(Prisma.sql`
        SELECT
          a.id,
          sa.session_id AS sessionId,
          a.job_id AS jobId,
          j.trigger_source AS triggerSource,
          a.template,
          a.summary_text AS summaryText,
          a.summary_json AS summaryJson,
          a.risk_level AS riskLevel,
          a.created_at AS createdAt
        FROM session_audit_ai_artifacts a
        INNER JOIN session_audits sa ON sa.id = a.session_audit_id
        INNER JOIN session_audit_ai_jobs j ON j.id = a.job_id
        WHERE sa.tenant_id = ${tenantId}
          AND sa.session_id = ${sessionId}
        ORDER BY a.created_at DESC
      `)
    } catch (err) {
      if (isTableMissingError(err)) return []
      logger.error({ err }, 'Session audit AI artifacts by session query failed')
      return []
    }
  }

  async enqueueManualSummaryJob(input: {
    sessionId: number
    tenantId: number
    requestedByUserId: number
    provider: string
    model?: string | null
    promptVersion?: string | null
  }): Promise<void> {
    try {
      await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO session_audit_ai_jobs (
            session_audit_id,
            tenant_id,
            requested_by_user_id,
            kind,
            trigger_source,
            provider,
            model,
            status,
            prompt_version,
            error_message,
            started_at,
            finished_at,
            created_at,
            updated_at
          )
          SELECT
            sa.id,
            sa.tenant_id,
            ${input.requestedByUserId},
            ${'SUMMARY'},
            ${'MANUAL'},
            ${input.provider},
            ${input.model ?? null},
            ${'PENDING'},
            ${input.promptVersion ?? 'summary-v1'},
            NULL,
            NULL,
            NULL,
            NOW(),
            NOW()
          FROM session_audits sa
          WHERE sa.session_id = ${input.sessionId}
            AND sa.tenant_id = ${input.tenantId}
            AND sa.status = ${'COMPLETED'}
          ON DUPLICATE KEY UPDATE
            requested_by_user_id = VALUES(requested_by_user_id),
            provider = VALUES(provider),
            model = VALUES(model),
            status = ${'PENDING'},
            prompt_version = VALUES(prompt_version),
            error_message = NULL,
            started_at = NULL,
            finished_at = NULL,
            updated_at = NOW()
        `)

        await tx.$executeRaw(Prisma.sql`
          UPDATE session_audits
          SET
            ai_summary_status = ${'PENDING'},
            updated_at = NOW()
          WHERE session_id = ${input.sessionId}
        `)
      })
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit AI manual job enqueue failed')
    }
  }

  async markProcessing(jobId: number): Promise<void> {
    try {
      await this.db.$transaction([
        this.db.$executeRaw(Prisma.sql`
          UPDATE session_audit_ai_jobs
          SET
            status = ${'PROCESSING'},
            started_at = NOW(),
            updated_at = NOW()
          WHERE id = ${jobId}
        `),
        this.db.$executeRaw(Prisma.sql`
          UPDATE session_audits sa
          INNER JOIN session_audit_ai_jobs j ON j.session_audit_id = sa.id
          SET
            sa.ai_summary_status = ${'PROCESSING'},
            sa.updated_at = NOW()
          WHERE j.id = ${jobId}
        `),
      ])
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit AI job mark processing failed')
    }
  }

  async markReady(jobId: number, input: { summaryText: string; summaryJson: string; riskLevel?: string | null }): Promise<void> {
    try {
      await this.db.$transaction([
        this.db.$executeRaw(Prisma.sql`
          UPDATE session_audit_ai_jobs
          SET
            status = ${'READY'},
            error_message = NULL,
            finished_at = NOW(),
            updated_at = NOW()
          WHERE id = ${jobId}
        `),
        this.db.$executeRaw(Prisma.sql`
          INSERT INTO session_audit_ai_artifacts (
            session_audit_id,
            job_id,
            template,
            summary_text,
            summary_json,
            risk_level,
            created_at
          )
          SELECT
            j.session_audit_id,
            j.id,
            COALESCE(j.prompt_version, 'summary-v1'),
            ${input.summaryText},
            ${input.summaryJson},
            ${input.riskLevel ?? null},
            NOW()
          FROM session_audit_ai_jobs j
          WHERE j.id = ${jobId}
        `),
        this.db.$executeRaw(Prisma.sql`
          UPDATE session_audits sa
          INNER JOIN session_audit_ai_jobs j ON j.session_audit_id = sa.id
          SET
            sa.ai_summary_status = CASE
              WHEN j.trigger_source = ${'AUTO_POST_SESSION'} OR sa.ai_summary_json IS NULL THEN ${'READY'}
              ELSE sa.ai_summary_status
            END,
            sa.ai_summary_text = CASE
              WHEN j.trigger_source = ${'AUTO_POST_SESSION'} OR sa.ai_summary_json IS NULL THEN ${input.summaryText}
              ELSE sa.ai_summary_text
            END,
            sa.ai_summary_json = CASE
              WHEN j.trigger_source = ${'AUTO_POST_SESSION'} OR sa.ai_summary_json IS NULL THEN ${input.summaryJson}
              ELSE sa.ai_summary_json
            END,
            sa.ai_risk_level = CASE
              WHEN j.trigger_source = ${'AUTO_POST_SESSION'} OR sa.ai_summary_json IS NULL THEN ${input.riskLevel ?? null}
              ELSE sa.ai_risk_level
            END,
            sa.updated_at = NOW()
          WHERE j.id = ${jobId}
        `),
      ])
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit AI job mark ready failed')
    }
  }

  async markFailed(jobId: number, errorMessage: string): Promise<void> {
    try {
      await this.db.$transaction([
        this.db.$executeRaw(Prisma.sql`
          UPDATE session_audit_ai_jobs
          SET
            status = ${'FAILED'},
            error_message = ${errorMessage},
            finished_at = NOW(),
            updated_at = NOW()
          WHERE id = ${jobId}
        `),
        this.db.$executeRaw(Prisma.sql`
          UPDATE session_audits sa
          INNER JOIN session_audit_ai_jobs j ON j.session_audit_id = sa.id
          SET
            sa.ai_summary_status = ${'FAILED'},
            sa.updated_at = NOW()
          WHERE j.id = ${jobId}
        `),
      ])
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit AI job mark failed failed')
    }
  }

  async markCanceled(jobId: number, reason: string): Promise<void> {
    try {
      await this.db.$transaction([
        this.db.$executeRaw(Prisma.sql`
          UPDATE session_audit_ai_jobs
          SET
            status = ${'CANCELED'},
            error_message = ${reason},
            finished_at = NOW(),
            updated_at = NOW()
          WHERE id = ${jobId}
        `),
        this.db.$executeRaw(Prisma.sql`
          UPDATE session_audits sa
          INNER JOIN session_audit_ai_jobs j ON j.session_audit_id = sa.id
          SET
            sa.ai_summary_status = CASE
              WHEN sa.ai_summary_json IS NULL THEN ${'FAILED'}
              ELSE sa.ai_summary_status
            END,
            sa.updated_at = NOW()
          WHERE j.id = ${jobId}
        `),
      ])
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit AI job mark canceled failed')
    }
  }

  private handlePersistenceError(err: unknown, message: string): void {
    if (isTableMissingError(err)) {
      if (!this.warnedMissingTable) {
        this.warnedMissingTable = true
        logger.warn({ err }, 'Session audit AI jobs table not available yet; persistence disabled')
      }
      return
    }
    logger.error({ err }, message)
  }
}

function isTableMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (err.message.includes('session_audit_ai_jobs') || err.message.includes('session_audit_ai_artifacts')) && (
    err.message.includes("doesn't exist")
    || err.message.includes('does not exist')
    || err.message.includes('no such table')
  )
}
