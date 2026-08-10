import { describe, expect, it, vi } from 'vitest'
import { SessionCommandSshInputPolicy, type SessionCommandRuleProvider } from './session-command-ssh-input-policy.js'
import type { SshInputPolicyContext } from '../ssh/ssh-input-policy.js'

const context: SshInputPolicyContext = {
  sessionId: 10,
  tenantId: 1,
  userId: 2,
  hostId: 3,
  source: 'websocket_gateway',
}

describe('SessionCommandSshInputPolicy', () => {
  it('blocks a command submitted after interactive typing and returns line cleanup', async () => {
    const provider: SessionCommandRuleProvider = {
      async getRules() {
        return [{
          id: 'rule-1',
          type: 'prefix',
          pattern: 'rm -rf',
          action: 'block',
          message: 'Comando bloqueado',
          enabled: true,
          priority: 100,
        }]
      },
    }
    const policy = new SessionCommandSshInputPolicy(provider)

    for (const chunk of ['r', 'm', ' ', '-', 'r', 'f', ' ', '/']) {
      const decision = await policy.evaluate(Buffer.from(chunk), context)
      expect(decision.allow).toBe(true)
      expect(decision.data?.toString()).toBe(chunk)
    }

    const blocked = await policy.evaluate(Buffer.from('\r'), context)
    expect(blocked.allow).toBe(false)
    expect(blocked.message).toBe('Comando bloqueado')
    expect([...blocked.data ?? []]).toEqual([21])
  })

  it('does not forward pasted blocked commands', async () => {
    const provider: SessionCommandRuleProvider = {
      async getRules() {
        return [{
          id: 'rule-1',
          type: 'contains',
          pattern: 'shutdown',
          action: 'block',
          enabled: true,
          priority: 100,
        }]
      },
    }
    const policy = new SessionCommandSshInputPolicy(provider)

    const blocked = await policy.evaluate(Buffer.from('sudo shutdown now\n'), context)
    expect(blocked.allow).toBe(false)
    expect(blocked.data?.toString()).toBe('\x15')
  })

  it('uses the effective default action when no rule matches', async () => {
    const provider: SessionCommandRuleProvider = {
      async getRules() {
        return []
      },
      async getDefaultAction() {
        return 'block'
      },
    }
    const policy = new SessionCommandSshInputPolicy(provider)

    const blocked = await policy.evaluate(Buffer.from('whoami\n'), context)
    expect(blocked.allow).toBe(false)
    expect(blocked.message).toBe('Comando bloqueado por politica')
    expect(blocked.data?.toString()).toBe('\x15')
  })

  it('does not query policy storage for each interactive keystroke', async () => {
    const provider: SessionCommandRuleProvider = {
      getRules: vi.fn().mockResolvedValue([]),
      getDefaultAction: vi.fn().mockResolvedValue('allow'),
    }
    const policy = new SessionCommandSshInputPolicy(provider)

    for (const key of ['h', 't', 'o', 'p']) await policy.evaluate(Buffer.from(key), context)
    expect(provider.getRules).not.toHaveBeenCalled()
    expect(provider.getDefaultAction).not.toHaveBeenCalled()

    await policy.evaluate(Buffer.from('\r'), context)
    expect(provider.getRules).toHaveBeenCalledTimes(1)
    expect(provider.getDefaultAction).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent chunks and evaluates the complete command in order', async () => {
    let releaseFirst!: () => void
    const firstLookup = new Promise<void>((resolve) => { releaseFirst = resolve })
    const provider: SessionCommandRuleProvider = {
      getRules: vi.fn()
        .mockImplementationOnce(async () => {
          await firstLookup
          return [{ id: 'block-htop', type: 'exact', pattern: 'htop', action: 'block', enabled: true, priority: 1 }]
        })
        .mockResolvedValue([]),
    }
    const policy = new SessionCommandSshInputPolicy(provider)

    await Promise.all(['h', 't', 'o', 'p'].map((key) => policy.evaluate(Buffer.from(key), context)))
    const enter = policy.evaluate(Buffer.from('\r'), context)
    const next = policy.evaluate(Buffer.from('x'), context)
    releaseFirst()

    await expect(enter).resolves.toMatchObject({ allow: false })
    await expect(next).resolves.toMatchObject({ allow: true })
  })
})
