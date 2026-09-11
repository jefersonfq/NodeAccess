import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({
  env: {
    PEM_ENCRYPTION_KEY: '0'.repeat(64),
    JWT_SECRET: 'host-link-test-secret',
    APP_URL: 'https://nodeaccess.example',
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

describe('HostLinkService sharing contracts', () => {
  function createService(pinRequired: boolean) {
    const hostLinkRepo = {
      create: vi.fn().mockImplementation(async (input) => ({ id: 71, ...input })),
    }
    const hostRepo = {
      findById: vi.fn().mockResolvedValue({ id: 10, tenantId: 1, name: 'host-a' }),
    }
    const sshRepo = {
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(true),
    }
    const logRepo = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const policyReader = {
      findJitAccessSettings: vi.fn().mockResolvedValue({
        enabled: true,
        expiryMinutes: [10],
        maxExpiryMinutes: 10,
        pinRequired,
      }),
    }
    return {
      hostLinkRepo,
      service: new HostLinkService(
        hostLinkRepo as never,
        hostRepo as never,
        sshRepo as never,
        logRepo as never,
        policyReader,
      ),
    }
  }

  it('creates authenticated links on the login-aware own-session route', async () => {
    const { service } = createService(false)
    const result = await service.create({ hostId: 10, type: 'authenticated', expiresInMinutes: 10 }, 1, 20, 'USER')

    expect(new URL(result.url).pathname).toMatch(/^\/host-links\/[A-Za-z0-9_-]+$/)
    expect(result.pinRequired).toBe(false)
    expect(result.pin).toBeUndefined()
  })

  it('creates public one-time JIT links with a recoverable six-digit PIN', async () => {
    const { hostLinkRepo, service } = createService(true)
    const result = await service.create({ hostId: 10, type: 'public_once', expiresInMinutes: 10 }, 1, 20, 'ADMIN')

    expect(new URL(result.url).pathname).toMatch(/^\/jit-access\/[A-Za-z0-9_-]+$/)
    expect(result.pinRequired).toBe(true)
    expect(result.pin).toMatch(/^\d{6}$/)
    expect(hostLinkRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PUBLIC_ONCE',
      pinHash: expect.any(String),
      pinEncrypted: expect.any(String),
    }))
  })
})
