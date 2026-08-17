import { describe, expect, it, vi } from 'vitest'
import { AiScriptArtifactService } from './ai-script-artifact.service.js'

const user = { sub: '11', tenantId: 7, role: 'admin' as const, email: 'admin@example.test', stage: 'authenticated' as const }

function setup(risks: Array<'safe' | 'approval_required' | 'blocked'> = ['safe']) {
  const repository = {
    create: vi.fn().mockImplementation(async (input) => ({ id: 3, ...input, actionRunId: null, destination: '/tmp/nodeaccess-ai-script-3.sh', status: 'draft', createdAt: new Date(), updatedAt: new Date() })),
    findById: vi.fn(),
  }
  const actionService = { createRequestedRun: vi.fn().mockResolvedValue({ id: 91 }) }
  const service = new AiScriptArtifactService(
    repository as never,
    actionService as never,
    { assertFeatureLicensed: vi.fn().mockResolvedValue(undefined) } as never,
    { evaluateMany: vi.fn().mockImplementation(({ commands }) => Promise.resolve(commands.map((command: string, index: number) => ({ command, risk: risks[index] ?? risks[0] })))) } as never,
    { hasEffectiveHostPermission: vi.fn().mockResolvedValue(true) } as never,
    { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never,
  )
  return { service, repository, actionService }
}

describe('AiScriptArtifactService', () => {
  it('normalizes a script, calculates checksum and creates a reviewable artifact', async () => {
    const { service, repository } = setup()
    const artifact = await service.create(user, { hostId: 42, title: 'Diagnóstico', objective: 'Verificar carga', content: 'uptime' })
    expect(artifact.destination).toBe('/tmp/nodeaccess-ai-script-3.sh')
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      content: '#!/usr/bin/env bash\nset -euo pipefail\nuptime\n',
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      risk: 'safe',
    }))
  })

  it('rejects scripts containing commands blocked by tenant policy', async () => {
    const { service } = setup(['blocked'])
    await expect(service.create(user, { hostId: 42, title: 'Perigoso', objective: 'Teste', content: 'rm -rf /tmp/a' })).rejects.toThrow('bloqueados')
  })

  it('always creates an approval_required ActionRun for execution', async () => {
    const { service, repository, actionService } = setup()
    repository.findById.mockResolvedValue({
      id: 3, tenantId: 7, hostId: 42, createdById: 11, actionRunId: null, title: 'Diagnóstico', objective: 'Carga',
      destination: '/tmp/nodeaccess-ai-script-3.sh', content: '#!/bin/bash\nuptime\n', checksum: 'a'.repeat(64),
      status: 'draft', risk: 'safe', createdAt: new Date(), updatedAt: new Date(),
    })
    await service.requestExecution(user, 3)
    expect(actionService.createRequestedRun).toHaveBeenCalledWith(expect.objectContaining({ dto: expect.objectContaining({
      mode: 'approval_required', scriptArtifactId: 3,
      steps: [expect.objectContaining({ command: "bash -- '/tmp/nodeaccess-ai-script-3.sh'" })],
    }) }))
  })
})
