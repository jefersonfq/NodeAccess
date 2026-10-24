import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import type { SharedSessionService } from './shared-session.service.js'
import type { SharedSessionBroker } from './shared-session.broker.js'
vi.mock('../../config/env.js', () => ({ env: { JWT_SECRET: 'synthetic-frame-fixture' } }))
vi.mock('jsonwebtoken', () => ({ default: { verify: () => ({ sub: '7', tenantId: 9, role: 'user', stage: 'authenticated' }) } }))
vi.mock('../trials/trial-policy.js', () => ({
  assertTrialUserAccess: () => Promise.resolve(null),
  assertTrialResource: () => Promise.resolve(),
  monitorTrialAccess: () => () => {},
}))
import { SharedSessionGateway } from './shared-session.gateway.js'

describe('shared session websocket text frames', () => {
  it.each(['buffer', 'array-buffer', 'fragments'])('accepts %s ping and cleans viewer exactly once', async format => {
    const ws = Object.assign(new EventEmitter(), { readyState: 1, send: vi.fn(), close: vi.fn() })
    const service = {
      joinChannel: vi.fn().mockResolvedValue({ sessionId: 2, role: 'viewer', sharedSession: {
        id: 3, hostId: 4, hostName: 'Fixture', owner: { userId: 8 }, participants: [], status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000),
      } }),
      touchChannelParticipant: vi.fn().mockResolvedValue(true),
      leaveChannel: vi.fn().mockResolvedValue(undefined),
    }
    const broker = { registerSharedSession: vi.fn(), subscribe: vi.fn(), publishSnapshot: vi.fn(), sendInitialSnapshot: vi.fn(), unsubscribe: vi.fn(), publishParticipantLeft: vi.fn() }
    await new SharedSessionGateway(service as unknown as SharedSessionService, broker as unknown as SharedSessionBroker).handleConnection(ws as unknown as WebSocket, 'synthetic-token', 3)
    try {
      const bytes = Buffer.from('{"type":"ping"}')
      const raw = format === 'buffer' ? bytes : format === 'fragments' ? [bytes.subarray(0, 5), bytes.subarray(5)] : Uint8Array.from(bytes).buffer
      ws.emit('message', raw, false)
      await Promise.resolve()
      expect(service.touchChannelParticipant).toHaveBeenCalledExactlyOnceWith(3, 7)
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }))
      ws.emit('message', Buffer.from('not-json'), false)
      expect(service.touchChannelParticipant).toHaveBeenCalledTimes(1)
    } finally {
      ws.emit('close')
      ws.emit('error', new Error('already closed'))
      await Promise.resolve()
    }
    expect(service.leaveChannel).toHaveBeenCalledExactlyOnceWith(3, 7)
    expect(broker.unsubscribe).toHaveBeenCalledExactlyOnceWith(3, ws)
  })
})
