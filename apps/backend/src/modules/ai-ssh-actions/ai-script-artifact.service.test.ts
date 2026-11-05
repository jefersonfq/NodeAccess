import { describe, expect, it, vi } from 'vitest'
import type { AiScriptArtifactRepository } from './ai-script-artifact.repository.js'
import { AiScriptArtifactService } from './ai-script-artifact.service.js'

const user = { sub: '11', tenantId: 7, role: 'admin' as const, email: 'admin@example.test', stage: 'authenticated' as const }

function setup(risks: Array<'safe' | 'approval_required' | 'blocked'> = ['safe']) {
  const repository = {
    create: vi.fn((input: Parameters<AiScriptArtifactRepository['create']>[0]) => Promise.resolve({ id: 3, ...input, actionRunId: null, destination: '/tmp/nodeaccess-ai-script-3.sh', status: 'draft', createdAt: new Date(), updatedAt: new Date() })),
    findById: vi.fn(),
  }
  const actionService = { createRequestedRun: vi.fn().mockResolvedValue({ id: 91 }) }
  const service = new AiScriptArtifactService(
    repository as never,
    actionService as never,
    { assertFeatureLicensed: vi.fn().mockResolvedValue(undefined) } as never,
    { evaluateMany: vi.fn().mockImplementation(({ commands }: { commands: string[] }) => Promise.resolve(commands.map((command: string, index: number) => ({ command, risk: risks[index] ?? risks[0] })))) } as never,
    { hasEffectiveHostPermission: vi.fn().mockResolvedValue(true) } as never,
    { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never,
  )
  return { service, repository, actionService }
}

describe('AiScriptArtifactService', () => {
  it('requires a new reviewed artifact after a prior run instead of reusing its destination', async () => {
    const { service, repository, actionService } = setup()
    repository.findById.mockResolvedValue({ id: 3, tenantId: 7, hostId: 42, actionRunId: 91, status: 'failed' })
    await expect(service.requestExecution(user, 3)).rejects.toThrow('já encaminhado')
    expect(actionService.createRequestedRun).not.toHaveBeenCalled()
  })

  it('normalizes a script, calculates checksum and creates a reviewable artifact', async () => {
    const { service, repository } = setup()
    const artifact = await service.create(user, { hostId: 42, title: 'Diagnóstico', objective: 'Verificar carga', content: 'uptime' })
    expect(artifact.destination).toBe('/tmp/nodeaccess-ai-script-3.sh')
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      content: '#!/usr/bin/env bash\nset -euo pipefail\nuptime\n',
      risk: 'safe',
    }))
    expect(repository.create.mock.calls[0]?.[0].checksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects scripts containing commands blocked by tenant policy', async () => {
    const { service } = setup(['blocked'])
    await expect(service.create(user, { hostId: 42, title: 'Perigoso', objective: 'Teste', content: 'rm -rf /tmp/a' })).rejects.toThrow('bloqueados')
  })

  it('always creates an approval_required ActionRun for execution', async () => {
    const { service, repository, actionService } = setup()
    repository.findById.mockResolvedValue({
      id: 3, tenantId: 7, hostId: 42, createdById: 11, actionRunId: null, title: 'Diagnóstico', objective: 'Carga',
      destination: '/tmp/nodeaccess-ai-script-340282366920938463463374607431768211455.sh', content: '#!/bin/bash\nuptime\n', checksum: 'a'.repeat(64),
      status: 'draft', risk: 'safe', createdAt: new Date(), updatedAt: new Date(),
    })
    await service.requestExecution(user, 3)
    expect(actionService.createRequestedRun.mock.calls).toMatchObject([[{ dto: {
      mode: 'approval_required', scriptArtifactId: 3,
      steps: [{ command: "bash -- '/tmp/nodeaccess-ai-script-340282366920938463463374607431768211455.sh'" }],
    } }]])
  })
})
