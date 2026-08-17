import { describe, expect, it, vi } from 'vitest'
import { AiInvestigationService } from './ai-investigation.service.js'

const base = {
  id: 12, tenantId: 3, hostId: 42, hostName: 'API', hostIp: '10.0.0.42', requestedById: 7,
  requestedByName: 'Operador', mcpTokenId: 8, mcpTokenName: 'diagnostico', objective: 'Investigar carga',
  status: 'WAITING_USER', expiresAt: new Date(Date.now() + 60_000), lastActivityAt: new Date(),
  closedAt: null, closeReason: null, createdAt: new Date(),
}

function setup(overrides: Record<string, unknown> = {}) {
  const repo = {
    expire: vi.fn(), create: vi.fn().mockResolvedValue(12), find: vi.fn().mockResolvedValue({ ...base, ...overrides }),
    list: vi.fn(), actionRuns: vi.fn().mockResolvedValue([{ id: 91 }]), reports: vi.fn().mockResolvedValue([]),
    attachRun: vi.fn(), touch: vi.fn(), addReport: vi.fn(), close: vi.fn(),
  }
  const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  return { service: new AiInvestigationService(repo as never, logs as never), repo, logs }
}

describe('AiInvestigationService', () => {
  it('cria contexto lógico com TTL limitado e trilha administrativa', async () => {
    const { service, repo, logs } = setup({ status: 'OPEN' })
    await service.start({ tenantId: 3, userId: 7, hostId: 42, tokenId: 8, objective: 'Investigar', ttlMinutes: 1 })
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 3, hostId: 42, objective: 'Investigar' }))
    const expiresAt = repo.create.mock.calls[0][0].expiresAt as Date
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000)
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'AI_INVESTIGATION_STARTED', targetId: 12 }))
  })

  it('vincula ActionRun e muda o contexto para aguardar decisão do usuário', async () => {
    const { service, repo } = setup()
    await service.attachRun(12, 91, 3)
    expect(repo.attachRun).toHaveBeenCalledWith(12, 91, 3)
    expect(repo.touch).toHaveBeenCalledWith(12, 3, 'WAITING_USER')
  })

  it('rejeita evidência de outra investigação', async () => {
    const { service, repo } = setup()
    await expect(service.complete(12, 3, 7, {
      summary: 'Conclusão', facts: [], hypotheses: [], risks: [], recommendations: [], actions: [],
      evidence: [{ actionRunId: 999, stepIds: [] }], confirmedByUser: true,
    })).rejects.toMatchObject({ code: 'AI_INVESTIGATION_INVALID_EVIDENCE' })
    expect(repo.addReport).not.toHaveBeenCalled()
  })

  it('separa relatório de evidências, mascara segredos e grava checksum verificável', async () => {
    const { service, repo, logs } = setup()
    await service.complete(12, 3, 7, {
      summary: 'Disco saudável token=abc123', facts: ['password: supersecret'], hypotheses: ['Possível inode'],
      risks: [], recommendations: ['Monitorar'], actions: ['df -h'], evidence: [{ actionRunId: 91, stepIds: ['disk'] }],
      provider: 'openai', model: 'gpt-test', confirmedByUser: true,
    })
    expect(repo.addReport).toHaveBeenCalledWith(expect.objectContaining({
      investigationId: 12, redactionApplied: true, checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      sanitized: expect.objectContaining({ summary: 'Disco saudável token=[redacted]', facts: ['password=[redacted]'] }),
    }))
    expect(repo.close).toHaveBeenCalledWith(12, 3, 'COMPLETED', 'user_confirmed')
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'AI_INVESTIGATION_COMPLETED' }))
  })

  it('não aceita novas execuções em investigação encerrada', async () => {
    const { service, repo } = setup({ status: 'COMPLETED' })
    await expect(service.attachRun(12, 92, 3)).rejects.toMatchObject({ code: 'AI_INVESTIGATION_CLOSED' })
    expect(repo.attachRun).not.toHaveBeenCalled()
    await expect(service.abandon(12, 3, 7)).rejects.toMatchObject({ code: 'AI_INVESTIGATION_CLOSED' })
    expect(repo.close).not.toHaveBeenCalled()
  })
})
