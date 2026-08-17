import type { AiSshActionRunDetail } from '@nodeaccess/shared'
import type { SessionAuditPolicyService } from '../session-audit/session-audit-policy.service.js'
import type { SessionAuditPublisher } from '../session-audit/session-audit.publisher.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { AiSshActionRepository } from './ai-ssh-action.repository.js'

export interface ActionAuditHandle {
  sessionId: number
  context: { sessionId: number; tenantId: number; userId: number; hostId: number }
}

export class AiSshActionAuditService {
  constructor(
    private readonly repository: AiSshActionRepository,
    private readonly sshRepository: SshRepository,
    private readonly publisher: SessionAuditPublisher,
    private readonly policy: SessionAuditPolicyService,
  ) {}

  async start(run: AiSshActionRunDetail): Promise<ActionAuditHandle | null> {
    if (!await this.policy.shouldAuditAutomation(run.tenantId)) return null
    const snapshots = await this.repository.findAuditContext(run.id, run.tenantId)
    if (!snapshots) return null

    const routeSnapshot = {
      auditKind: 'ai_action_run',
      actionRunId: run.id,
      investigationId: run.investigationId ?? null,
      channel: run.channel,
      mode: run.mode,
      mcpTokenId: snapshots.tokenId,
      mcpTokenName: snapshots.tokenName,
      approvedById: run.approvedById,
      hasPty: false,
    }
    const sessionId = await this.sshRepository.startSession(run.requestedById, run.hostId, {
      connectionMethod: 'mcp_action_run',
      accessType: 'ai_automation',
      userAgent: `NodeAccess ActionRun/${run.id}`,
      routeSnapshot,
    })
    const context = { sessionId, tenantId: run.tenantId, userId: run.requestedById, hostId: run.hostId }
    await this.publisher.publish('session_started', context, {
      userName: snapshots.userName,
      userEmail: snapshots.userEmail,
      hostName: snapshots.hostName,
      hostIp: snapshots.hostIp,
      connectionMethod: 'mcp_action_run',
      routeSnapshot,
      actionRunId: run.id,
      cols: 0,
      rows: 0,
    })
    return { sessionId, context }
  }

  async recordCommand(handle: ActionAuditHandle | null, command: string): Promise<void> {
    if (!handle) return
    const data = Buffer.from(`${command}\n`)
    await this.publisher.publish('stdin', handle.context, {
      encoding: 'base64', data: data.toString('base64'), bytes: data.length, actorSource: 'mcp_agent',
    })
  }

  async recordResult(handle: ActionAuditHandle | null, output: string, exitCode: number | null): Promise<void> {
    if (!handle) return
    const suffix = `\n[NodeAccess exit=${exitCode ?? 'indisponivel'}]\n`
    const data = Buffer.from(`${output}${suffix}`)
    await this.publisher.publish('stdout', handle.context, {
      encoding: 'base64', data: data.toString('base64'), bytes: data.length, exitCode,
    })
  }

  async finish(handle: ActionAuditHandle | null, failed: boolean): Promise<void> {
    if (!handle) return
    await this.publisher.publish(failed ? 'session_error' : 'session_ended', handle.context, {
      reason: failed ? 'action_run_failed' : 'action_run_completed',
    })
    await this.sshRepository.endSession(handle.sessionId, {
      endedReason: 'automation_completed',
      ...(failed ? { errorCode: 'AI_ACTION_RUN_FAILED' } : {}),
    })
  }
}
