import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})
import { BastionService } from './bastion.service.js'

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 21, tenantId: 7, name: 'jump-prod', ip: '10.0.0.21', port: 22,
    sshUser: 'ubuntu', authType: 'PEM', accessProtocol: 'SSH', connectionMode: 'DIRECT',
    pemKeyId: 9, passwordEncrypted: null, onePasswordRef: null,
    bastionId: null, groupBastionId: null, ...overrides,
  }
}

function fixture(sourceHost = source()) {
  const repository = {
    findSourceHost: vi.fn().mockResolvedValue(sourceHost),
    findBySourceHostId: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async (data) => ({
      id: 31, ...data, pemKeyId: null, systemPemKeyId: data.systemPemKeyId ?? null,
      sourceHostId: data.sourceHostId ?? null, sourceHost,
      passwordEncrypted: data.passwordEncrypted ?? null,
      createdAt: new Date(), updatedAt: new Date(),
    })),
  }
  const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  return { repository, logs, service: new BastionService(repository as never, logs as never) }
}

describe('BastionService host-backed profiles', () => {
  it('enables an eligible existing Host without duplicating its secret input', async () => {
    const { service, repository, logs } = fixture()
    const result = await service.create({ sourceHostId: 21 }, 7, 11)

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      sourceHostId: 21, tenantId: 7, name: 'jump-prod',
    }))
    expect(repository.create.mock.calls[0]?.[0]).not.toHaveProperty('systemPemKeyId')
    expect(repository.create.mock.calls[0]?.[0]).not.toHaveProperty('passwordEncrypted')
    expect(result).toMatchObject({ sourceHostId: 21, sourceType: 'host', name: 'jump-prod' })
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ENABLE_HOST_AS_BASTION', targetType: 'Host', targetId: 21,
    }))
  })

  it.each([
    ['non SSH', { accessProtocol: 'RDP' }, 'Somente hosts SSH'],
    ['non direct', { connectionMode: 'AGENT' }, 'conexão direta'],
    ['1Password', { onePasswordRef: 'op://vault/item/password' }, '1Password'],
    ['direct bastion dependency', { bastionId: 4 }, 'depende de outro bastion'],
    ['inherited bastion dependency', { groupBastionId: 4 }, 'depende de outro bastion'],
    ['missing PEM', { pemKeyId: null }, 'chave PEM cadastrada'],
  ])('rejects %s source hosts', async (_label, overrides, message) => {
    const { service, repository } = fixture(source(overrides))
    await expect(service.create({ sourceHostId: 21 }, 7, 11)).rejects.toThrow(message)
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('rejects enabling the same Host twice', async () => {
    const { service, repository } = fixture()
    repository.findBySourceHostId.mockResolvedValue({ id: 31 })
    await expect(service.create({ sourceHostId: 21 }, 7, 11)).rejects.toThrow('já está habilitado')
  })

  it('does not allow technical edits through a host-backed profile', async () => {
    const { service, repository } = fixture()
    repository.findById = vi.fn().mockResolvedValue({ id: 31, sourceHostId: 21 })
    await expect(service.update(31, { ip: '10.0.0.99' }, 7, 11)).rejects.toThrow('Host de origem')
  })
})
