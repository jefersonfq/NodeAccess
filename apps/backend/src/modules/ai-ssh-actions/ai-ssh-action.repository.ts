import { Prisma, type PrismaClient } from '@prisma/client'
import type { AiSshActionRunDetail, AiSshActionRunPublic, CreateAiSshActionRunDto, AiSshActionRunStep } from '@nodeaccess/shared'
import { ConflictError } from '../../shared/errors.js'

type ActionRunRow = AiSshActionRunPublic
type ActionRunStepRow = AiSshActionRunStep

function mapStatus(value: string): AiSshActionRunPublic['status'] {
  return String(value).toLowerCase() as AiSshActionRunPublic['status']
}

function mapMode(value: string): AiSshActionRunPublic['mode'] {
  return String(value).toLowerCase() as AiSshActionRunPublic['mode']
}

function mapChannel(value: string): AiSshActionRunPublic['channel'] {
  return String(value).toLowerCase() as AiSshActionRunPublic['channel']
}

function mapRun(row: ActionRunRow): AiSshActionRunPublic {
  return {
    ...row,
    status: mapStatus(row.status),
    mode: mapMode(row.mode),
    channel: mapChannel(row.channel),
  }
}

function mapStep(row: ActionRunStepRow): AiSshActionRunStep {
  return {
    ...row,
    status: String(row.status).toLowerCase() as AiSshActionRunStep['status'],
  }
}

function isMissingStorageError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2021') return true
  if (error.code === 'P2010') {
    const message = String((error.meta as { message?: string } | undefined)?.message ?? '')
    return message.includes('ai_ssh_action_runs') || message.includes('ai_ssh_action_run_steps') || message.includes('1146')
  }
  return false
}

export class AiSshActionRepository {
  constructor(private readonly db: PrismaClient) {}

  async createRequestedRun(input: {
    tenantId: number
    requestedById: number
    dto: CreateAiSshActionRunDto
  }): Promise<AiSshActionRunDetail> {
    try {
      const runId = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO ai_ssh_action_runs (
            tenant_id,
            host_id,
            requested_by_id,
            channel,
            mode,
            status,
            summary,
            plan_json,
            approval_reason,
            created_at,
            updated_at
          ) VALUES (
            ${input.tenantId},
            ${input.dto.hostId},
            ${input.requestedById},
            ${input.dto.channel.toUpperCase()},
            ${input.dto.mode.toUpperCase()},
            ${input.dto.mode === 'approval_required' ? 'PENDING_APPROVAL' : 'APPROVED'},
            ${input.dto.summary},
            ${JSON.stringify({ steps: input.dto.steps })},
            ${input.dto.approvalReason ?? null},
            NOW(),
            NOW()
          )
        `)

        const runRows = await tx.$queryRaw<Array<{ id: bigint | number }>>(Prisma.sql`SELECT LAST_INSERT_ID() AS id`)
        const runId = Number(runRows[0]?.id)

        for (const step of input.dto.steps) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO ai_ssh_action_run_steps (
              run_id,
              step_id,
              label,
              command,
              timeout_seconds,
              status,
              redaction_applied,
              created_at
            ) VALUES (
              ${runId},
              ${step.id},
              ${step.label},
              ${step.command},
              ${step.timeoutSeconds},
              ${'PENDING'},
              ${false},
              NOW()
            )
          `)
        }

        return runId
      })

      const detail = await this.findDetailById(runId, input.tenantId)
      if (!detail) throw new Error('Falha ao carregar o action run criado')
      return detail
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async findDetailById(id: number, tenantId: number): Promise<AiSshActionRunDetail | null> {
    try {
      const rows = await this.db.$queryRaw<ActionRunRow[]>(Prisma.sql`
        SELECT
          id,
          tenant_id AS tenantId,
          host_id AS hostId,
          requested_by_id AS requestedById,
          approved_by_id AS approvedById,
          LOWER(channel) AS channel,
          LOWER(mode) AS mode,
          LOWER(status) AS status,
          summary,
          approval_reason AS approvalReason,
          error_message AS errorMessage,
          started_at AS startedAt,
          finished_at AS finishedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM ai_ssh_action_runs
        WHERE id = ${id}
          AND tenant_id = ${tenantId}
        LIMIT 1
      `)
      const row = rows[0]
      if (!row) return null

      const steps = await this.db.$queryRaw<ActionRunStepRow[]>(Prisma.sql`
        SELECT
          id,
          step_id AS stepId,
          label,
          command,
          timeout_seconds AS timeoutSeconds,
          LOWER(status) AS status,
          exit_code AS exitCode,
          output_preview AS outputPreview,
          redaction_applied AS redactionApplied,
          started_at AS startedAt,
          finished_at AS finishedAt
        FROM ai_ssh_action_run_steps
        WHERE run_id = ${id}
        ORDER BY id ASC
      `)

      return {
        ...mapRun(row),
        steps: steps.map(mapStep),
      }
    } catch (error) {
      if (isMissingStorageError(error)) return null
      throw error
    }
  }

  async findByHost(hostId: number, tenantId: number): Promise<AiSshActionRunPublic[]> {
    try {
      const rows = await this.db.$queryRaw<ActionRunRow[]>(Prisma.sql`
        SELECT
          id,
          tenant_id AS tenantId,
          host_id AS hostId,
          requested_by_id AS requestedById,
          approved_by_id AS approvedById,
          LOWER(channel) AS channel,
          LOWER(mode) AS mode,
          LOWER(status) AS status,
          summary,
          approval_reason AS approvalReason,
          error_message AS errorMessage,
          started_at AS startedAt,
          finished_at AS finishedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM ai_ssh_action_runs
        WHERE tenant_id = ${tenantId}
          AND host_id = ${hostId}
        ORDER BY created_at DESC
        LIMIT 20
      `)
      return rows.map(mapRun)
    } catch (error) {
      if (isMissingStorageError(error)) return []
      throw error
    }
  }

  async approveRun(input: {
    id: number
    tenantId: number
    approvedById: number
    approvalReason?: string | null
  }): Promise<AiSshActionRunDetail> {
    try {
      const affected = await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_runs
        SET
          approved_by_id = ${input.approvedById},
          approval_reason = ${input.approvalReason ?? null},
          status = ${'APPROVED'},
          updated_at = NOW()
        WHERE id = ${input.id}
          AND tenant_id = ${input.tenantId}
          AND status = ${'PENDING_APPROVAL'}
      `)
      if (affected === 0) throw new Error('NOT_FOUND')
      const detail = await this.findDetailById(input.id, input.tenantId)
      if (!detail) throw new Error('NOT_FOUND')
      return detail
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async rejectRun(input: {
    id: number
    tenantId: number
    approvedById: number
    approvalReason?: string | null
  }): Promise<AiSshActionRunDetail> {
    try {
      const affected = await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_runs
        SET
          approved_by_id = ${input.approvedById},
          approval_reason = ${input.approvalReason ?? null},
          status = ${'REJECTED'},
          finished_at = NOW(),
          updated_at = NOW()
        WHERE id = ${input.id}
          AND tenant_id = ${input.tenantId}
          AND status IN (${Prisma.join(['PENDING_APPROVAL', 'APPROVED'])})
      `)
      if (affected === 0) throw new Error('NOT_FOUND')
      const detail = await this.findDetailById(input.id, input.tenantId)
      if (!detail) throw new Error('NOT_FOUND')
      return detail
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async markRunStarted(id: number, tenantId: number): Promise<boolean> {
    try {
      const affected = await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_runs
        SET
          status = ${'RUNNING'},
          started_at = IFNULL(started_at, NOW()),
          updated_at = NOW()
        WHERE id = ${id}
          AND tenant_id = ${tenantId}
          AND status = ${'APPROVED'}
      `)
      return affected > 0
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async markStepStarted(runId: number, stepId: string): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_run_steps
        SET
          status = ${'RUNNING'},
          started_at = IFNULL(started_at, NOW())
        WHERE run_id = ${runId}
          AND step_id = ${stepId}
      `)
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async markStepCompleted(input: {
    runId: number
    stepId: string
    exitCode: number | null
    outputPreview: string | null
    redactionApplied: boolean
  }): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_run_steps
        SET
          status = ${'COMPLETED'},
          exit_code = ${input.exitCode},
          output_preview = ${input.outputPreview},
          redaction_applied = ${input.redactionApplied},
          finished_at = NOW()
        WHERE run_id = ${input.runId}
          AND step_id = ${input.stepId}
      `)
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async markStepFailed(input: {
    runId: number
    stepId: string
    exitCode: number | null
    outputPreview: string | null
    redactionApplied: boolean
  }): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_run_steps
        SET
          status = ${'FAILED'},
          exit_code = ${input.exitCode},
          output_preview = ${input.outputPreview},
          redaction_applied = ${input.redactionApplied},
          finished_at = NOW()
        WHERE run_id = ${input.runId}
          AND step_id = ${input.stepId}
      `)
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async markPendingStepsSkipped(runId: number): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_run_steps
        SET
          status = ${'SKIPPED'},
          finished_at = IFNULL(finished_at, NOW())
        WHERE run_id = ${runId}
          AND status = ${'PENDING'}
      `)
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async markRunningStepsSkipped(runId: number, outputPreview: string | null): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_run_steps
        SET
          status = ${'SKIPPED'},
          output_preview = COALESCE(${outputPreview}, output_preview),
          finished_at = IFNULL(finished_at, NOW())
        WHERE run_id = ${runId}
          AND status = ${'RUNNING'}
      `)
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async markRunCompleted(id: number, tenantId: number): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_runs
        SET
          status = ${'COMPLETED'},
          finished_at = NOW(),
          error_message = NULL,
          updated_at = NOW()
        WHERE id = ${id}
          AND tenant_id = ${tenantId}
          AND status <> ${'CANCELED'}
      `)
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async markRunFailed(id: number, tenantId: number, errorMessage: string): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_runs
        SET
          status = ${'FAILED'},
          error_message = ${errorMessage},
          finished_at = NOW(),
          updated_at = NOW()
        WHERE id = ${id}
          AND tenant_id = ${tenantId}
          AND status <> ${'CANCELED'}
      `)
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }

  async cancelRun(input: {
    id: number
    tenantId: number
    errorMessage: string
  }): Promise<AiSshActionRunDetail> {
    try {
      const affected = await this.db.$executeRaw(Prisma.sql`
        UPDATE ai_ssh_action_runs
        SET
          status = ${'CANCELED'},
          error_message = ${input.errorMessage},
          finished_at = NOW(),
          updated_at = NOW()
        WHERE id = ${input.id}
          AND tenant_id = ${input.tenantId}
          AND status IN (${Prisma.join(['PENDING_APPROVAL', 'APPROVED', 'RUNNING'])})
      `)
      if (affected === 0) throw new Error('NOT_FOUND')
      const detail = await this.findDetailById(input.id, input.tenantId)
      if (!detail) throw new Error('NOT_FOUND')
      return detail
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de actions por IA ainda nao estao disponiveis. Aplique a migration antes de usar esta frente.')
      }
      throw error
    }
  }
}
