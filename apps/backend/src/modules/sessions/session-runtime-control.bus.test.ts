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

  connect(): Promise<void> {
    return Promise.resolve()
  }

  subscribe(channel: string): Promise<void> {
    this.subscriptions.add(channel)
    return Promise.resolve()
  }

  unsubscribe(channel: string): Promise<void> {
    this.subscriptions.delete(channel)
    return Promise.resolve()
  }

  disconnect(): void {
    this.peers.delete(this)
  }

  publish(channel: string, message: string): Promise<number> {
    let delivered = 0
    for (const peer of this.peers) {
      if (!peer.subscriptions.has(channel)) continue
      delivered += 1
      peer.emit('message', channel, message)
    }
    return Promise.resolve(delivered)
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


describe('distributed closure confirmation', () => {
  it.each(['connect', 'subscribe'] as const)('does not publish when %s resolves after the closure deadline', async phase => {
    vi.useFakeTimers()
    const redis = new FakeRedis(), subscriber = new FakeRedis(), missing = { close: vi.fn(() => false) }
    let release!: () => void
    const delayed = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(redis, 'duplicate').mockReturnValue(subscriber)
    const subscribe = vi.spyOn(subscriber, 'subscribe')
    if (phase === 'subscribe') subscribe.mockReturnValue(delayed)
    else vi.spyOn(subscriber, 'connect').mockReturnValue(delayed)
    const disconnect = vi.spyOn(subscriber, 'disconnect')
    const publish = vi.spyOn(redis, 'publish')
    const bus = new SessionRuntimeControlBus(redis as never, missing as never, missing as never)
    try {
      const result = bus.closeSession(1, 20)
      await vi.advanceTimersByTimeAsync(20)
      expect(await result).toEqual({ closed: false, handledByRuntime: false })
      release()
      await vi.advanceTimersByTimeAsync(0)
      expect(publish).not.toHaveBeenCalled()
      expect(disconnect).toHaveBeenCalled()
      expect(subscribe).toHaveBeenCalledTimes(phase === 'subscribe' ? 1 : 0)
      expect(vi.getTimerCount()).toBe(0)
    } finally { release(); vi.useRealTimers() }
  })
  it.each([true, false])('waits for the owner even when non-owner replies first=%s', async nonOwnerFirst => {
    const redis = new FakeRedis(), missing = { close: vi.fn(() => false) }, owner = { close: vi.fn(() => true) }
    const ownerBus = new SessionRuntimeControlBus(redis as never, owner as never, missing as never)
    const otherBus = new SessionRuntimeControlBus(redis as never, missing as never, missing as never)
    const buses = nonOwnerFirst ? [otherBus, ownerBus] : [ownerBus, otherBus]
    for (const bus of buses) await bus.start()
    try {
      const outcomes = await Promise.all([otherBus.closeSession(1, 100), otherBus.closeSession(2, 100)])
      expect(outcomes).toEqual([{ closed: true, handledByRuntime: true }, { closed: true, handledByRuntime: true }])
    } finally { for (const bus of buses) await bus.stop() }
  })
  it('does not confirm a runtime absent from all peers', async () => {
    const redis = new FakeRedis(), missing = { close: vi.fn(() => false) }
    const bus = new SessionRuntimeControlBus(redis as never, missing as never, missing as never)
    await bus.start()
    try { expect(await bus.closeSession(1, 20)).toEqual({ closed: false, handledByRuntime: false }) }
    finally { await bus.stop() }
  })
  it('ignores a matching request with the wrong session id', async () => {
    const redis = new FakeRedis(), missing = { close: vi.fn(() => false) }
    const publish = redis.publish.bind(redis)
    vi.spyOn(redis, 'publish').mockImplementation(async (channel, raw) => {
      if (channel === 'nodeaccess:sessions:runtime-close') {
        const request = JSON.parse(raw) as { sessionId: number; requestId: string }
        await publish('nodeaccess:sessions:runtime-close:response', JSON.stringify({ ...request,
          type: 'session_close_response', sessionId: request.sessionId + 1, closed: true, handledByRuntime: true }))
      }
      return publish(channel, raw)
    })
    const bus = new SessionRuntimeControlBus(redis as never, missing as never, missing as never)
    expect(await bus.closeSession(1, 20)).toEqual({ closed: false, handledByRuntime: false })
  })
  it('reports unconfirmed when a runtime callback throws', async () => {
    const redis = new FakeRedis(), broken = { close: vi.fn(() => { throw new Error('close failed') }) }, missing = { close: vi.fn(() => false) }
    const bus = new SessionRuntimeControlBus(redis as never, broken as never, missing as never)
    await bus.start()
    try { expect(await bus.closeSession(1, 20)).toEqual({ closed: false, handledByRuntime: false }) }
    finally { await bus.stop() }
  })
})
