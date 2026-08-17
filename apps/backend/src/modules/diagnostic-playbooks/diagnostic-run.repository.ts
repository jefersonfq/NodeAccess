import { Prisma, type PrismaClient } from '@prisma/client'
import type { DiagnosticRunAiSummary, DiagnosticRunCommand, DiagnosticRunDetail, DiagnosticRunPublic } from '@nodeaccess/shared'
import type { DiagnosticPlaybookPublic } from '@nodeaccess/shared'
import { ConflictError } from '../../shared/errors.js'

type DiagnosticRunRow = Omit<DiagnosticRunPublic, 'playbookName' | 'aiSummaryStructured'> & {
  playbookName: string
  aiFindingsJson?: string | null
}

type DiagnosticRunCommandRow = DiagnosticRunCommand

export interface DiagnosticRunHistoryRow {
  runId: number
  playbookId: number
  playbookName: string
  status: DiagnosticRunPublic['status']
  createdAt: Date
  finishedAt: Date | null
  aiSummaryStructured: DiagnosticRunAiSummary | null
  completedCommands: number
  failedCommands: number
  skippedCommands: number
}

function mapRunStatus(value: string): DiagnosticRunPublic['status'] {
  return String(value).toLowerCase() as DiagnosticRunPublic['status']
}

function mapCommandStatus(value: string): DiagnosticRunCommand['status'] {
  return String(value).toLowerCase() as DiagnosticRunCommand['status']
}

function mapRun(row: DiagnosticRunRow): DiagnosticRunPublic {
  return {
    ...row,
    status: mapRunStatus(row.status),
    aiSummaryStructured: parseAiSummary(row.aiFindingsJson),
  }
}

function mapCommand(row: DiagnosticRunCommandRow): DiagnosticRunCommand {
  return {
    ...row,
    status: mapCommandStatus(row.status),
  }
}

export class DiagnosticRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async createRequestedRun(input: {
    tenantId: number
    hostId: number
    playbook: DiagnosticPlaybookPublic
    requestedById: number
  }): Promise<DiagnosticRunDetail> {
    try {
      const runId = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO diagnostic_runs (
            tenant_id,
            host_id,
            playbook_id,
            requested_by_id,
            trigger_source,
            status,
            created_at,
            updated_at
          ) VALUES (
            ${input.tenantId},
            ${input.hostId},
            ${input.playbook.id},
            ${input.requestedById},
            ${'manual'},
            ${'PENDING'},
            NOW(),
            NOW()
          )
        `)

        const runRows = await tx.$queryRaw<Array<{ id: bigint | number }>>(Prisma.sql`SELECT LAST_INSERT_ID() AS id`)
        const runId = Number(runRows[0]?.id)

        for (const command of input.playbook.commands) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO diagnostic_run_commands (
              run_id,
              command_id,
              command,
              status,
              redaction_applied,
              created_at
            ) VALUES (
              ${runId},
              ${command.id},
              ${command.command},
              ${'PENDING'},
              ${false},
              NOW()
            )
          `)
        }

        return runId
      })

      const detail = await this.findDetailById(runId, input.tenantId)
      if (!detail) {
        throw new Error('Falha ao carregar a execucao de diagnostico criada')
      }
      return detail
    } catch (error) {
      if (isMissingDiagnosticStorageError(error)) {
        throw new ConflictError('As tabelas de diagnostico ainda nao estao disponiveis. Aplique a migration antes de executar playbooks.')
      }
      throw error
    }
  }

  async findByHost(hostId: number, tenantId: number): Promise<DiagnosticRunPublic[]> {
    try {
      const rows = await this.db.$queryRaw<DiagnosticRunRow[]>(Prisma.sql`
        SELECT
          dr.id,
          dr.host_id AS hostId,
          h.name AS hostName,
          h.ip AS hostIp,
          dr.playbook_id AS playbookId,
          COALESCE(dp.name, CONCAT('Playbook #', dr.playbook_id)) AS playbookName,
          LOWER(dr.status) AS status,
          dr.requested_by_id AS requestedById,
          dr.approved_by_id AS approvedById,
          dr.trigger_source AS triggerSource,
          dr.origin_session_id AS originSessionId,
          dr.origin_ticket_key AS originTicketKey,
          dr.origin_action_run_id AS originActionRunId,
          dr.error_message AS errorMessage,
          dr.ai_summary_status AS aiSummaryStatus,
          dr.ai_summary_text AS aiSummaryText,
          dr.ai_findings_json AS aiFindingsJson,
          dr.started_at AS startedAt,
          dr.finished_at AS finishedAt,
          dr.created_at AS createdAt,
          dr.updated_at AS updatedAt
        FROM diagnostic_runs dr
        LEFT JOIN diagnostic_playbooks dp ON dp.id = dr.playbook_id
        LEFT JOIN hosts h ON h.id = dr.host_id AND h.tenant_id = dr.tenant_id
        WHERE dr.tenant_id = ${tenantId}
          AND dr.host_id = ${hostId}
        ORDER BY dr.created_at DESC
        LIMIT 10
      `)
      return rows.map(mapRun)
    } catch (error) {
      if (isMissingDiagnosticStorageError(error)) {
        return []
      }
      throw error
    }
  }

  async findHistoryByHost(hostId: number, tenantId: number, limit = 30): Promise<DiagnosticRunHistoryRow[]> {
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
    try {
      const rows = await this.db.$queryRaw<Array<{
        runId: number
        playbookId: number
        playbookName: string
        status: string
        createdAt: Date
        finishedAt: Date | null
        aiFindingsJson: string | null
        completedCommands: bigint | number
        failedCommands: bigint | number
        skippedCommands: bigint | number
      }>>(Prisma.sql`
        SELECT
          dr.id AS runId,
          dr.playbook_id AS playbookId,
          COALESCE(dp.name, CONCAT('Playbook #', dr.playbook_id)) AS playbookName,
          LOWER(dr.status) AS status,
          dr.created_at AS createdAt,
          dr.finished_at AS finishedAt,
          dr.ai_findings_json AS aiFindingsJson,
          COALESCE(SUM(CASE WHEN drc.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completedCommands,
          COALESCE(SUM(CASE WHEN drc.status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failedCommands,
          COALESCE(SUM(CASE WHEN drc.status = 'SKIPPED' THEN 1 ELSE 0 END), 0) AS skippedCommands
        FROM diagnostic_runs dr
        LEFT JOIN diagnostic_playbooks dp ON dp.id = dr.playbook_id
        LEFT JOIN diagnostic_run_commands drc ON drc.run_id = dr.id
        WHERE dr.tenant_id = ${tenantId}
          AND dr.host_id = ${hostId}
        GROUP BY dr.id, dr.playbook_id, dp.name, dr.status, dr.created_at, dr.finished_at, dr.ai_findings_json
        ORDER BY dr.created_at DESC
        LIMIT ${safeLimit}
      `)
      return rows.map((row) => ({
        runId: Number(row.runId),
        playbookId: Number(row.playbookId),
        playbookName: row.playbookName,
        status: mapRunStatus(row.status),
        createdAt: row.createdAt,
        finishedAt: row.finishedAt,
        aiSummaryStructured: parseAiSummary(row.aiFindingsJson),
        completedCommands: Number(row.completedCommands),
        failedCommands: Number(row.failedCommands),
        skippedCommands: Number(row.skippedCommands),
      }))
    } catch (error) {
      if (isMissingDiagnosticStorageError(error)) return []
      throw error
    }
  }

  async findDetailById(id: number, tenantId: number): Promise<DiagnosticRunDetail | null> {
    try {
      const rows = await this.db.$queryRaw<DiagnosticRunRow[]>(Prisma.sql`
        SELECT
          dr.id,
          dr.host_id AS hostId,
          h.name AS hostName,
          h.ip AS hostIp,
          dr.playbook_id AS playbookId,
          COALESCE(dp.name, CONCAT('Playbook #', dr.playbook_id)) AS playbookName,
          LOWER(dr.status) AS status,
          dr.requested_by_id AS requestedById,
          dr.approved_by_id AS approvedById,
          dr.trigger_source AS triggerSource,
          dr.origin_session_id AS originSessionId,
          dr.origin_ticket_key AS originTicketKey,
          dr.origin_action_run_id AS originActionRunId,
          dr.error_message AS errorMessage,
          dr.ai_summary_status AS aiSummaryStatus,
          dr.ai_summary_text AS aiSummaryText,
          dr.ai_findings_json AS aiFindingsJson,
          dr.started_at AS startedAt,
          dr.finished_at AS finishedAt,
          dr.created_at AS createdAt,
          dr.updated_at AS updatedAt
        FROM diagnostic_runs dr
        LEFT JOIN diagnostic_playbooks dp ON dp.id = dr.playbook_id
        LEFT JOIN hosts h ON h.id = dr.host_id AND h.tenant_id = dr.tenant_id
        WHERE dr.tenant_id = ${tenantId}
          AND dr.id = ${id}
        LIMIT 1
      `)
      const row = rows[0]
      if (!row) return null

      const commands = await this.db.$queryRaw<DiagnosticRunCommandRow[]>(Prisma.sql`
        SELECT
          id,
          command_id AS commandId,
          command,
          LOWER(status) AS status,
          exit_code AS exitCode,
          output_preview AS outputPreview,
          output_body AS outputBody,
          redaction_applied AS redactionApplied,
          started_at AS startedAt,
          finished_at AS finishedAt
        FROM diagnostic_run_commands
        WHERE run_id = ${id}
        ORDER BY id ASC
      `)

      return {
        ...mapRun(row),
        commands: commands.map(mapCommand),
      }
    } catch (error) {
      if (isMissingDiagnosticStorageError(error)) {
        return null
      }
      throw error
    }
  }

  async markRunStarted(id: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_runs
      SET
        status = ${'RUNNING'},
        started_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}
    `)
  }

  async validateTraceabilityReferences(input: {
    tenantId: number
    hostId: number
    userId: number
    role: 'ADMIN' | 'USER'
    sessionId: number | null
    ticketKey: string | null
    actionRunId: number | null
  }): Promise<{ sessionValid: boolean; ticketValid: boolean; actionRunValid: boolean }> {
    const ownUserId = input.role === 'USER' ? input.userId : null
    const [sessionRows, ticketRows, actionRunRows] = await Promise.all([
      input.sessionId === null ? Promise.resolve([{ valid: 1 }]) : this.db.$queryRaw<Array<{ valid: number }>>(Prisma.sql`
        SELECT 1 AS valid
        FROM session_audits
        WHERE tenant_id = ${input.tenantId}
          AND host_id = ${input.hostId}
          AND session_id = ${input.sessionId}
          AND (${ownUserId} IS NULL OR user_id = ${ownUserId})
        LIMIT 1
      `),
      input.ticketKey === null ? Promise.resolve([{ valid: 1 }]) : this.db.$queryRaw<Array<{ valid: number }>>(Prisma.sql`
        SELECT 1 AS valid
        FROM session_audits
        WHERE tenant_id = ${input.tenantId}
          AND host_id = ${input.hostId}
          AND ticket_key = ${input.ticketKey}
          AND (${ownUserId} IS NULL OR user_id = ${ownUserId})
        LIMIT 1
      `),
      input.actionRunId === null ? Promise.resolve([{ valid: 1 }]) : this.db.$queryRaw<Array<{ valid: number }>>(Prisma.sql`
        SELECT 1 AS valid
        FROM ai_ssh_action_runs
        WHERE tenant_id = ${input.tenantId}
          AND host_id = ${input.hostId}
          AND id = ${input.actionRunId}
          AND (${ownUserId} IS NULL OR requested_by_id = ${ownUserId})
        LIMIT 1
      `),
    ])
    return {
      sessionValid: sessionRows.length > 0,
      ticketValid: ticketRows.length > 0,
      actionRunValid: actionRunRows.length > 0,
    }
  }

  async updateTraceability(input: {
    id: number
    tenantId: number
    sessionId: number | null
    ticketKey: string | null
    actionRunId: number | null
  }): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_runs
      SET
        origin_session_id = ${input.sessionId},
        origin_ticket_key = ${input.ticketKey},
        origin_action_run_id = ${input.actionRunId},
        updated_at = NOW()
      WHERE id = ${input.id}
        AND tenant_id = ${input.tenantId}
    `)
  }

  async markRunCompleted(id: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_runs
      SET
        status = ${'COMPLETED'},
        finished_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}
    `)
  }

  async markRunFailed(id: number, errorMessage: string): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_runs
      SET
        status = ${'FAILED'},
        error_message = ${errorMessage},
        finished_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}
    `)
  }

  async markCommandStarted(runId: number, commandId: string): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_run_commands
      SET
        status = ${'RUNNING'},
        started_at = NOW()
      WHERE run_id = ${runId}
        AND command_id = ${commandId}
    `)
  }

  async markCommandCompleted(input: {
    runId: number
    commandId: string
    exitCode: number | null
    outputPreview: string | null
    outputBody: string | null
    redactionApplied: boolean
  }): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_run_commands
      SET
        status = ${'COMPLETED'},
        exit_code = ${input.exitCode},
        output_preview = ${input.outputPreview},
        output_body = ${input.outputBody},
        redaction_applied = ${input.redactionApplied},
        finished_at = NOW()
      WHERE run_id = ${input.runId}
        AND command_id = ${input.commandId}
    `)
  }

  async markCommandFailed(input: {
    runId: number
    commandId: string
    exitCode: number | null
    outputPreview: string | null
    outputBody: string | null
    redactionApplied?: boolean
  }): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_run_commands
      SET
        status = ${'FAILED'},
        exit_code = ${input.exitCode},
        output_preview = ${input.outputPreview},
        output_body = ${input.outputBody},
        redaction_applied = ${input.redactionApplied ?? false},
        finished_at = NOW()
      WHERE run_id = ${input.runId}
        AND command_id = ${input.commandId}
    `)
  }

  async markPendingCommandsSkipped(runId: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_run_commands
      SET
        status = ${'SKIPPED'},
        finished_at = NOW()
      WHERE run_id = ${runId}
        AND status = ${'PENDING'}
    `)
  }

  async markAiSummaryProcessing(runId: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_runs
      SET
        ai_summary_status = ${'PROCESSING'},
        ai_summary_text = NULL,
        updated_at = NOW()
      WHERE id = ${runId}
    `)
  }

  async markAiSummaryReady(runId: number, input: {
    summaryText: string
    findingsJson: string
  }): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_runs
      SET
        ai_summary_status = ${'READY'},
        ai_summary_text = ${input.summaryText},
        ai_findings_json = ${input.findingsJson},
        updated_at = NOW()
      WHERE id = ${runId}
    `)
  }

  async markAiSummaryFailed(runId: number, failureMessage: string | null = null): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE diagnostic_runs
      SET
        ai_summary_status = ${'FAILED'},
        ai_summary_text = ${failureMessage},
        ai_findings_json = NULL,
        updated_at = NOW()
      WHERE id = ${runId}
    `)
  }
}

function parseAiSummary(value: string | null | undefined): DiagnosticRunAiSummary | null {
  if (!value) return null
  try {
    return JSON.parse(value) as DiagnosticRunAiSummary
  } catch {
    return null
  }
}

function isMissingDiagnosticStorageError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2021') return true
  if (error.code !== 'P2010') return false

  const meta = error.meta as { code?: string | number; message?: string } | undefined
  const rawCode = String(meta?.code ?? '')
  const rawMessage = String(meta?.message ?? error.message).toLowerCase()

  return rawCode === '1146'
    || rawMessage.includes('diagnostic_runs')
    || rawMessage.includes('diagnostic_run_commands')
    || rawMessage.includes('diagnostic_playbooks')
}
