import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({
  env: {
    FEATURE_SESSION_AUDIT: true,
    FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY: false,
    SESSION_AUDIT_CHUNK_MAX_BYTES: 512,
  },
}))

import { env } from '../../config/env.js'
import { SessionAuditPublisher } from './session-audit.publisher.js'

const CONTEXT = {
  sessionId: 123,
  tenantId: 1,
  userId: 10,
  hostId: 20,
}

function createHarness() {
  const starts: unknown[] = []
  const finishes: unknown[] = []
  const appendedChunks: unknown[] = []
  const storedChunks = new Map<string, string>()
  const storedChunkContents: string[] = []
  const scheduledSummaries: Array<{ sessionId: number; tenantId: number }> = []

  const repository = {
    start: vi.fn(async (input: unknown) => { starts.push(input) }),
    finish: vi.fn(async (input: unknown) => { finishes.push(input) }),
    appendChunk: vi.fn(async (input: unknown) => { appendedChunks.push(input) }),
    updateCommandCount: vi.fn(async () => {}),
    listChunks: vi.fn(async () => appendedChunks.map((chunk) => ({
      seq: (chunk as { seq: number }).seq,
      storageKey: (chunk as { storageKey: string }).storageKey,
    }))),
  }

  const storage = {
    writeChunk: vi.fn(async (_sessionId: number, seq: number, content: string) => {
      const storageKey = `/tmp/session-audit/${seq}.jsonl.gz`
      storedChunks.set(storageKey, content)
      storedChunkContents.push(content)
      return {
        storageKey,
        compression: 'gzip',
        rawSize: Buffer.byteLength(content, 'utf-8'),
        compressedSize: Buffer.byteLength(content, 'utf-8'),
      }
    }),
    readChunk: vi.fn(async (storageKey: string) => storedChunks.get(storageKey) ?? ''),
  }

  const aiService = {
    schedulePostSessionSummary: vi.fn(async (sessionId: number, tenantId: number) => {
      scheduledSummaries.push({ sessionId, tenantId })
    }),
  }

  return {
    publisher: new SessionAuditPublisher(repository as never, storage as never, aiService as never),
    repository,
    storage,
    aiService,
    starts,
    finishes,
    appendedChunks,
    storedChunks: storedChunkContents,
    scheduledSummaries,
  }
}

function parseJsonl(content: string) {
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { seq: number; type: string; payload: Record<string, unknown> })
}

function payload(text: string) {
  return {
    encoding: 'base64',
    data: Buffer.from(text, 'utf-8').toString('base64'),
    bytes: Buffer.byteLength(text, 'utf-8'),
  }
}

describe('SessionAuditPublisher', () => {
  beforeEach(() => {
    env.FEATURE_SESSION_AUDIT = true
    env.FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY = false
    env.SESSION_AUDIT_CHUNK_MAX_BYTES = 512
  })

  it('persists a complete audit stream with start, input, output and end events', async () => {
    const harness = createHarness()

    await harness.publisher.publish('session_started', CONTEXT, {
      userName: 'Admin',
      userEmail: 'admin@example.com',
      hostName: 'prod-db',
      hostIp: '10.0.0.10',
      connectionMethod: 'direct',
    })
    await harness.publisher.publish('stdin', CONTEXT, payload('whoami\r'))
    await harness.publisher.publish('stdout', CONTEXT, payload('whoami\r\nroot\n[root@prod-db ~]# '))
    await harness.publisher.publish('session_ended', CONTEXT, { reason: 'socket_closed' })

    expect(harness.repository.start).toHaveBeenCalledTimes(1)
    expect(harness.repository.finish).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: CONTEXT.sessionId,
      status: 'COMPLETED',
    }))
    expect(harness.storage.writeChunk).toHaveBeenCalledTimes(1)

    const events = parseJsonl(harness.storedChunks.join(''))
    expect(events.map((event) => event.type)).toEqual([
      'session_started',
      'stdin',
      'stdout',
      'session_ended',
    ])
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4])
    expect(harness.appendedChunks[0]).toEqual(expect.objectContaining({
      sessionId: CONTEXT.sessionId,
      seq: 1,
      eventCount: 4,
      bytesInDelta: Buffer.byteLength('whoami\r', 'utf-8'),
      bytesOutDelta: Buffer.byteLength('whoami\r\nroot\n[root@prod-db ~]# ', 'utf-8'),
    }))
    expect(harness.repository.updateCommandCount).toHaveBeenCalledWith({
      sessionId: CONTEXT.sessionId,
      commandCount: 1,
    })
    expect(harness.aiService.schedulePostSessionSummary).toHaveBeenCalledWith(CONTEXT.sessionId, CONTEXT.tenantId)
  })

  it('serializes concurrent publish calls and preserves contiguous sequence numbers across chunks', async () => {
    env.SESSION_AUDIT_CHUNK_MAX_BYTES = 260
    const harness = createHarness()

    await harness.publisher.publish('session_started', CONTEXT, {
      userName: 'Admin',
      hostName: 'prod-db',
      hostIp: '10.0.0.10',
      connectionMethod: 'direct',
    })

    await Promise.all([
      harness.publisher.publish('stdin', CONTEXT, payload('echo one\r')),
      harness.publisher.publish('stdout', CONTEXT, payload('echo one\r\none\n')),
      harness.publisher.publish('resize', CONTEXT, { cols: 120, rows: 40 }),
      harness.publisher.publish('stdin', CONTEXT, payload('echo two\r')),
      harness.publisher.publish('stdout', CONTEXT, payload('echo two\r\ntwo\n')),
    ])
    await harness.publisher.publish('session_ended', CONTEXT, { reason: 'socket_closed' })

    expect(harness.storage.writeChunk.mock.calls.length).toBeGreaterThan(1)

    const events = harness.storedChunks.flatMap(parseJsonl)
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1))
    expect(events.map((event) => event.type)).toEqual([
      'session_started',
      'stdin',
      'stdout',
      'resize',
      'stdin',
      'stdout',
      'session_ended',
    ])

    const totals = harness.appendedChunks.reduce<{ bytesIn: number; bytesOut: number; eventCount: number }>((acc, chunk) => {
      const item = chunk as { bytesInDelta: number; bytesOutDelta: number; eventCount: number }
      acc.bytesIn += item.bytesInDelta
      acc.bytesOut += item.bytesOutDelta
      acc.eventCount += item.eventCount
      return acc
    }, { bytesIn: 0, bytesOut: 0, eventCount: 0 })

    expect(totals).toEqual({
      bytesIn: Buffer.byteLength('echo one\recho two\r', 'utf-8'),
      bytesOut: Buffer.byteLength('echo one\r\none\necho two\r\ntwo\n', 'utf-8'),
      eventCount: 7,
    })
  })

  it('marks session_error as failed, flushes evidence and does not schedule a post-session summary', async () => {
    const harness = createHarness()

    await harness.publisher.publish('session_started', CONTEXT, {
      userName: 'Admin',
      hostName: 'prod-db',
      hostIp: '10.0.0.10',
      connectionMethod: 'direct',
    })
    await harness.publisher.publish('stdin', CONTEXT, payload('sudo systemctl restart nginx\r'))
    await harness.publisher.publish('session_error', CONTEXT, { code: 'SSH_TARGET_CONNECT_FAILED' })

    expect(harness.repository.finish).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: CONTEXT.sessionId,
      status: 'FAILED',
    }))
    expect(harness.storage.writeChunk).toHaveBeenCalledTimes(1)
    expect(parseJsonl(harness.storedChunks[0] ?? '').map((event) => event.type)).toEqual([
      'session_started',
      'stdin',
      'session_error',
    ])
    expect(harness.aiService.schedulePostSessionSummary).not.toHaveBeenCalled()
  })
})
