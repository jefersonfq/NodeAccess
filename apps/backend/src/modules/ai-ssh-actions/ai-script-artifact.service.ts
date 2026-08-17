import { createHash } from 'node:crypto'
import type { AiScriptArtifactDetail, CreateAiScriptArtifactDto } from '@nodeaccess/shared'
import { ForbiddenError, NotFoundError } from '../../shared/errors.js'
import type { JwtPayload } from '../../shared/guards.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { AiSshActionPolicyService } from './ai-ssh-action.policy.js'
import type { AiSshActionCommandPolicyService } from './ai-ssh-action-command-policy.service.js'
import type { AiSshActionService } from './ai-ssh-action.service.js'
import type { AiScriptArtifactRepository } from './ai-script-artifact.repository.js'
import type { AiInteractionRepository } from '../local-ai/ai-interaction.repository.js'

export class AiScriptArtifactService {
  constructor(
    private readonly repository: AiScriptArtifactRepository,
    private readonly actionService: AiSshActionService,
    private readonly actionPolicy: AiSshActionPolicyService,
    private readonly commandPolicy: AiSshActionCommandPolicyService,
    private readonly sshRepository: SshRepository,
    private readonly logs: LogRepository,
    private readonly interactions?: AiInteractionRepository,
  ) {}

  async create(user: JwtPayload, dto: CreateAiScriptArtifactDto): Promise<AiScriptArtifactDetail> {
    await this.actionPolicy.assertFeatureLicensed(user.tenantId)
    const role = user.role === 'admin' ? 'ADMIN' : 'USER'
    if (!await this.sshRepository.hasEffectiveHostPermission(dto.hostId, user.tenantId, Number(user.sub), 'connect', role)) {
      throw new ForbiddenError('Sem permissão para conectar a este host')
    }
    const content = normalizeScript(dto.content)
    const commands = executableLines(content)
    if (!commands.length) throw new ForbiddenError('O script não contém comandos executáveis')
    const evaluations = await this.commandPolicy.evaluateMany({ tenantId: user.tenantId, commands })
    if (evaluations.some((item) => item.risk === 'blocked')) throw new ForbiddenError('O script contém comandos bloqueados pela policy do tenant')
    const risk = evaluations.some((item) => item.risk === 'approval_required') ? 'approval_required' : 'safe'
    const artifact = await this.repository.create({
      tenantId: user.tenantId, hostId: dto.hostId, createdById: Number(user.sub),
      title: dto.title.trim(), objective: dto.objective.trim(), content,
      checksum: createHash('sha256').update(content).digest('hex'), risk,
      interactionCorrelationId: dto.interactionCorrelationId ?? null,
    })
    if (dto.interactionCorrelationId) {
      await this.interactions?.linkArtifacts({ tenantId: user.tenantId, correlationId: dto.interactionCorrelationId, scriptArtifactId: artifact.id }).catch(() => {})
    }
    await this.logs.logAdminEvent({
      adminId: Number(user.sub), action: 'AI_SCRIPT_ARTIFACT_CREATED', targetType: 'AiScriptArtifact', targetId: artifact.id,
      details: JSON.stringify({ hostId: artifact.hostId, checksum: artifact.checksum, risk: artifact.risk, destination: artifact.destination }),
    }).catch(() => {})
    return artifact
  }

  async get(user: JwtPayload, id: number): Promise<AiScriptArtifactDetail> {
    await this.actionPolicy.assertFeatureLicensed(user.tenantId)
    const artifact = await this.repository.findById(id, user.tenantId)
    if (!artifact) throw new NotFoundError('Artefato de script')
    const role = user.role === 'admin' ? 'ADMIN' : 'USER'
    if (!await this.sshRepository.hasEffectiveHostPermission(artifact.hostId, user.tenantId, Number(user.sub), 'connect', role)) {
      throw new ForbiddenError('Sem permissão para visualizar este artefato')
    }
    return artifact
  }

  async requestExecution(user: JwtPayload, id: number, approvalReason?: string | null) {
    const artifact = await this.get(user, id)
    if (artifact.actionRunId || artifact.status !== 'draft') throw new ForbiddenError('Artefato de script já encaminhado para execução')
    const run = await this.actionService.createRequestedRun({
      tenantId: user.tenantId, userId: Number(user.sub), role: user.role === 'admin' ? 'ADMIN' : 'USER',
      dto: {
        hostId: artifact.hostId, channel: 'local_ai', mode: 'approval_required',
        summary: `Executar script governado: ${artifact.title}`,
        approvalReason: approvalReason?.trim() || `Objetivo: ${artifact.objective}`,
        scriptArtifactId: artifact.id,
        steps: [{ id: 'execute-script', label: artifact.title, command: `bash -- '${artifact.destination}'`, timeoutSeconds: 300 }],
      },
    })
    if (artifact.interactionCorrelationId) {
      await this.interactions?.linkArtifacts({ tenantId: user.tenantId, correlationId: artifact.interactionCorrelationId, actionRunId: run.id }).catch(() => {})
    }
    return run
  }
}

function normalizeScript(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  return normalized.startsWith('#!') ? `${normalized}\n` : `#!/usr/bin/env bash\nset -euo pipefail\n${normalized}\n`
}

function executableLines(content: string) {
  return content.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && !/^(set\s+-|then$|do$|done$|fi$|else$|elif\b|\{|\})/.test(line))
}
