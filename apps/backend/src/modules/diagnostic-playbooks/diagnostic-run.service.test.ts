import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({
  env: {
    PEM_ENCRYPTION_KEY: '0'.repeat(64),
  },
}))

import { ForbiddenError } from '../../shared/errors.js'
import { DiagnosticRunService } from './diagnostic-run.service.js'

describe('DiagnosticRunService ACL', () => {
  it('bloqueia execucao de diagnostico quando usuario nao tem permissao de conexao', async () => {
    const runRepo = {
      createRequestedRun: vi.fn(),
    }
    const playbookRepo = {
      findById: vi.fn(),
    }
    const sshRepo = {
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(false),
    }
    const service = new DiagnosticRunService(
      runRepo as never,
      playbookRepo as never,
      sshRepo as never,
      {} as never,
      { logAdminEvent: vi.fn() } as never,
      {} as never,
      {} as never,
    )

    await expect(service.createForHost({
      hostId:   10,
      tenantId: 1,
      userId:   20,
      role:     'USER',
      dto:      { playbookId: 30 },
    })).rejects.toBeInstanceOf(ForbiddenError)

    expect(sshRepo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 1, 20, 'connect', 'USER')
    expect(playbookRepo.findById).not.toHaveBeenCalled()
    expect(runRepo.createRequestedRun).not.toHaveBeenCalled()
  })
})
