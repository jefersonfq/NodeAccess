import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({
  env: {
    PEM_ENCRYPTION_KEY: '0'.repeat(64),
  },
}))

import { ForbiddenError } from '../../shared/errors.js'
import { HostLinkService } from './host-link.service.js'

describe('HostLinkService ACL', () => {
  it('bloqueia criacao de link quando usuario nao tem permissao de conexao', async () => {
    const hostLinkRepo = {
      create: vi.fn(),
    }
    const hostRepo = {
      findById: vi.fn().mockResolvedValue({
        id:       10,
        tenantId: 1,
        name:     'host-a',
      }),
    }
    const sshRepo = {
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(false),
    }
    const logRepo = {
      logAdminEvent: vi.fn(),
    }
    const service = new HostLinkService(
      hostLinkRepo as never,
      hostRepo as never,
      sshRepo as never,
      logRepo as never,
    )

    await expect(service.create({
      hostId:           10,
      type:             'authenticated',
      expiresInMinutes: 60,
    }, 1, 20, 'USER')).rejects.toBeInstanceOf(ForbiddenError)

    expect(hostRepo.findById).toHaveBeenCalledWith(10, 1)
    expect(sshRepo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 1, 20, 'connect', 'USER')
    expect(hostLinkRepo.create).not.toHaveBeenCalled()
    expect(logRepo.logAdminEvent).not.toHaveBeenCalled()
  })
})
