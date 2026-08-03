import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../shared/errors.js'
import { PortForwardingService } from './port-forwarding.service.js'

describe('PortForwardingService ACL', () => {
  it('bloqueia web target quando usuario nao tem permissao de conexao no host', async () => {
    const db = {
      portForwarding: {
        findFirst: vi.fn().mockResolvedValue({
          id:         50,
          hostId:     10,
          localPort:  8080,
          remoteHost: '127.0.0.1',
          remotePort: 80,
          description: null,
          host:       { id: 10, tenantId: 1 },
        }),
      },
      $queryRaw: vi.fn(),
    }
    const entitlements = {
      requireFeature: vi.fn().mockResolvedValue(undefined),
    }
    const sshRepo = {
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(false),
    }
    const service = new PortForwardingService(
      db as never,
      entitlements as never,
      { publishEvent: vi.fn() } as never,
      sshRepo as never,
    )

    await expect(service.getWebTarget(50, 1, 20, 'user')).rejects.toMatchObject<AppError>({
      statusCode: 404,
      code:       'FORWARDING_NOT_FOUND',
    })

    expect(entitlements.requireFeature).toHaveBeenCalledWith(1, 'portForwarding', 'Acessos locais não licenciados para este tenant')
    expect(sshRepo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 1, 20, 'connect', 'USER')
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })
})
