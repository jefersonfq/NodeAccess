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

describe('raw MySQL forwarding booleans', () => {
  it.each([0, 1, false, true])('normalizes autoStart and webEnabled %s in all read paths', async value => {
    const row = { id: 50, hostId: 10, autoStart: value, webEnabled: value }
    const db = {
      host: { findFirst: vi.fn().mockResolvedValue({ id: 10, tenantId: 1 }) },
      portForwarding: { findFirst: vi.fn().mockResolvedValue({ host: { id: 10, tenantId: 1 } }), update: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([row]),
    }
    const service = new PortForwardingService(db as never, { requireFeature: vi.fn() } as never, {} as never, {
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(true),
      findHostIdsWithEffectivePermission: vi.fn().mockResolvedValue(new Set([10])),
    } as never)
    const results = [
      ...(await service.list(10, 1, 20, 'user')),
      ...(await service.listAll(1, 20, 'admin')),
      ...(await service.listAll(1, 20, 'user')),
      await service.getWebTarget(50, 1, 20, 'user'),
      await service.update(50, 1, 20, 'admin', { autoStart: Boolean(value) }),
    ]
    for (const result of results) {
      expect(result.autoStart).toBe(Boolean(value))
      expect(result.webEnabled).toBe(Boolean(value))
    }
  })
})
