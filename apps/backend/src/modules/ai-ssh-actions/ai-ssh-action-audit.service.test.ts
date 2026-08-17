import { describe, expect, it, vi } from 'vitest'
import type { AiSshActionRunDetail } from '@nodeaccess/shared'
import { AiSshActionAuditService } from './ai-ssh-action-audit.service.js'

function run(): AiSshActionRunDetail {
  return {
    id: 8, tenantId: 1, hostId: 7026, requestedById: 1, approvedById: 4,
    channel: 'mcp', mode: 'approval_required', status: 'running', summary: 'Auditar firewall',
    approvalReason: 'Solicitado pelo operador', errorMessage: null, scriptArtifactId: null, mcpTokenId: 33,
    startedAt: new Date(), finishedAt: null, createdAt: new Date(), updatedAt: new Date(), steps: [],
  }
}

function setup(auditEnabled = true) {
  const repository = { findAuditContext: vi.fn().mockResolvedValue({
    userName: 'Operador', userEmail: 'ops@example.test', hostName: 'VPN KING HOST', hostIp: '177.153.202.21',
    tokenId: 33, tokenName: 'full_governado',
  }) }
  const ssh = {
    getUserGroupIds: vi.fn().mockResolvedValue([2, 3]),
    startSession: vi.fn().mockResolvedValue(901),
    endSession: vi.fn().mockResolvedValue(undefined),
  }
  const publisher = { publish: vi.fn().mockResolvedValue(undefined) }
  const policy = { shouldAuditAutomation: vi.fn().mockResolvedValue(auditEnabled) }
  return {
    service: new AiSshActionAuditService(repository as never, ssh as never, publisher as never, policy as never),
    repository, ssh, publisher, policy,
  }
}

describe('AiSshActionAuditService', () => {
  it('registra sessão não interativa, identidade, token, aprovação, comandos, saída e encerramento', async () => {
    const { service, ssh, publisher } = setup()
    const handle = await service.start(run())
    await service.recordCommand(handle, 'iptables -S')
    await service.recordResult(handle, '-P INPUT ACCEPT', 0)
    await service.finish(handle, false)

    expect(ssh.startSession).toHaveBeenCalledWith(1, 7026, expect.objectContaining({
      connectionMethod: 'mcp_action_run', accessType: 'ai_automation',
      routeSnapshot: expect.objectContaining({
        actionRunId: 8, mcpTokenId: 33, mcpTokenName: 'full_governado', approvedById: 4, hasPty: false,
      }),
    }))
    expect(publisher.publish).toHaveBeenNthCalledWith(1, 'session_started', expect.anything(), expect.objectContaining({
      userName: 'Operador', hostName: 'VPN KING HOST', connectionMethod: 'mcp_action_run',
    }))
    expect(Buffer.from(publisher.publish.mock.calls[1][2].data, 'base64').toString()).toBe('iptables -S\n')
    expect(Buffer.from(publisher.publish.mock.calls[2][2].data, 'base64').toString()).toContain('[NodeAccess exit=0]')
    expect(publisher.publish).toHaveBeenLastCalledWith('session_ended', expect.anything(), { reason: 'action_run_completed' })
    expect(ssh.endSession).toHaveBeenCalledWith(901, { endedReason: 'automation_completed' })
  })

  it('respeita a política de auditoria e não cria sessão quando desabilitada', async () => {
    const { service, ssh, publisher } = setup(false)
    const handle = await service.start(run())
    await service.recordCommand(handle, 'uptime')
    await service.finish(handle, false)
    expect(handle).toBeNull()
    expect(ssh.startSession).not.toHaveBeenCalled()
    expect(publisher.publish).not.toHaveBeenCalled()
  })

  it('encerra auditoria como falha sem ocultar a sessão', async () => {
    const { service, ssh, publisher } = setup()
    const handle = await service.start(run())
    await service.finish(handle, true)
    expect(publisher.publish).toHaveBeenLastCalledWith('session_error', expect.anything(), { reason: 'action_run_failed' })
    expect(ssh.endSession).toHaveBeenCalledWith(901, {
      endedReason: 'automation_completed', errorCode: 'AI_ACTION_RUN_FAILED',
    })
  })
})
