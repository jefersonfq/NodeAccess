import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { SessionRuntimeControlBus } from './session-runtime-control.bus.js'

vi.mock('../../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
}))

class FakeRedis extends EventEmitter {
  private readonly subscriptions = new Set<string>()

  constructor(private readonly peers: Set<FakeRedis> = new Set()) {
    super()
    this.peers.add(this)
  }

  duplicate(): FakeRedis {
    return new FakeRedis(this.peers)
  }

  async connect(): Promise<void> {
    return undefined
  }

  async subscribe(channel: string): Promise<void> {
    this.subscriptions.add(channel)
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subscriptions.delete(channel)
  }

  disconnect(): void {
    this.peers.delete(this)
  }

  async publish(channel: string, message: string): Promise<number> {
    let delivered = 0
    for (const peer of this.peers) {
      if (!peer.subscriptions.has(channel)) continue
      delivered += 1
      peer.emit('message', channel, message)
    }
    return delivered
  }
}

describe('SessionRuntimeControlBus', () => {
  it('propaga motivo acl_revoked para fechar sessao SSH ativa', async () => {
    const sshRuntimeRegistry = {
      close: vi.fn(() => true),
    }
    const graphicalRuntimeRegistry = {
      close: vi.fn(() => false),
    }
    const bus = new SessionRuntimeControlBus(
      new FakeRedis() as never,
      sshRuntimeRegistry as never,
      graphicalRuntimeRegistry as never,
    )

    await bus.start()
    const result = await bus.closeSession(123, 100, 'acl_revoked')
    await bus.stop()

    expect(result).toEqual({ closed: true, handledByRuntime: true })
    expect(sshRuntimeRegistry.close).toHaveBeenCalledWith(123, 'acl_revoked')
    expect(graphicalRuntimeRegistry.close).not.toHaveBeenCalled()
  })

  it('propaga motivo acl_revoked para fallback grafico quando nao ha runtime SSH', async () => {
    const sshRuntimeRegistry = {
      close: vi.fn(() => false),
    }
    const graphicalRuntimeRegistry = {
      close: vi.fn(() => true),
    }
    const bus = new SessionRuntimeControlBus(
      new FakeRedis() as never,
      sshRuntimeRegistry as never,
      graphicalRuntimeRegistry as never,
    )

    await bus.start()
    const result = await bus.closeSession(456, 100, 'acl_revoked')
    await bus.stop()

    expect(result).toEqual({ closed: true, handledByRuntime: true })
    expect(sshRuntimeRegistry.close).toHaveBeenCalledWith(456, 'acl_revoked')
    expect(graphicalRuntimeRegistry.close).toHaveBeenCalledWith(456, 'acl_revoked')
  })
})
