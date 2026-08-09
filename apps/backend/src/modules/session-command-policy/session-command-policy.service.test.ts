import { describe, expect, it, vi } from 'vitest'
import { SessionCommandPolicyService } from './session-command-policy.service.js'

const binding = {
  id: 1,
  policyGroupId: 10,
  targetType: 'global' as const,
  targetId: null,
  createdAt: new Date('2026-08-09T00:00:00Z'),
}

describe('SessionCommandPolicyService bindings', () => {
  it('rejeita vínculo global duplicado com conflito explícito', async () => {
    const repository = {
      listBindings: vi.fn().mockResolvedValue([binding]),
      createBinding: vi.fn(),
    }
    const service = new SessionCommandPolicyService(repository as never)

    await expect(service.createBinding(1, 10, { targetType: 'global' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SESSION_COMMAND_POLICY_BINDING_DUPLICATE',
    })
    expect(repository.createBinding).not.toHaveBeenCalled()
  })

  it('rejeita destino específico duplicado', async () => {
    const userBinding = { ...binding, targetType: 'user' as const, targetId: 7 }
    const repository = {
      listBindings: vi.fn().mockResolvedValue([userBinding]),
      createBinding: vi.fn(),
    }
    const service = new SessionCommandPolicyService(repository as never)

    await expect(service.createBinding(1, 10, { targetType: 'user', targetId: 7 })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('retorna somente o vínculo recém-criado', async () => {
    const created = { ...binding, id: 2, targetType: 'host' as const, targetId: 9 }
    const repository = {
      listBindings: vi.fn().mockResolvedValue([]),
      createBinding: vi.fn().mockResolvedValue(created),
    }
    const service = new SessionCommandPolicyService(repository as never)

    await expect(service.createBinding(1, 10, { targetType: 'host', targetId: 9 })).resolves.toEqual(created)
    expect(repository.createBinding).toHaveBeenCalledWith(1, 10, { targetType: 'host', targetId: 9 })
  })
})

describe('SessionCommandPolicyService rules', () => {
  it('retorna somente a regra recém-criada', async () => {
    const created = {
      id: '3', policyGroupId: 10, type: 'contains' as const, pattern: 'sudo', action: 'block' as const,
      priority: 100, enabled: true, createdAt: new Date(), updatedAt: new Date(),
    }
    const repository = { createRule: vi.fn().mockResolvedValue(created) }
    const service = new SessionCommandPolicyService(repository as never)

    await expect(service.createRule(1, 10, { pattern: 'sudo' })).resolves.toEqual(created)
  })
})
