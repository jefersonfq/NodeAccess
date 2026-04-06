import { randomUUID } from 'node:crypto'
import type { SessionAuditEvent } from '@nodeaccess/shared'
import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import type { SessionAuditAiService } from './session-audit-ai.service.js'
import type { SessionAuditRepository } from './session-audit.repository.js'
import type { SessionAuditStorage } from './session-audit.storage.js'

interface SessionAuditEventContext {
  sessionId: number
  tenantId: number
  userId: number
  hostId: number
}

interface BufferedSessionAuditChunk {
  seq: number
  startedAt: Date
  endedAt: Date
  eventCount: number
  bytesInDelta: number
  bytesOutDelta: number
  rawBytes: number
  lines: string[]
}

export class SessionAuditPublisher {
  private seqBySession = new Map<number, number>()
  private chunksBySession = new Map<number, BufferedSessionAuditChunk>()
  private queueBySession = new Map<number, Promise<void>>()

  constructor(
    private readonly repository: SessionAuditRepository,
    private readonly storage: SessionAuditStorage,
    private readonly aiService?: SessionAuditAiService,
  ) {}

  async publish(
    type: SessionAuditEvent['type'],
    context: SessionAuditEventContext,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    if (!env.FEATURE_SESSION_AUDIT) return

    const pending = this.queueBySession.get(context.sessionId) ?? Promise.resolve()
    const next = pending
      .catch(() => { /* ignore chained errors */ })
      .then(() => this.processEvent(type, context, payload))
      .finally(() => {
        if (this.queueBySession.get(context.sessionId) === next) {
          this.queueBySession.delete(context.sessionId)
        }
      })

    this.queueBySession.set(context.sessionId, next)
    return next
  }

  private async processEvent(
    type: SessionAuditEvent['type'],
    context: SessionAuditEventContext,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: SessionAuditEvent = {
      version: 1,
      eventId: randomUUID(),
      sessionId: context.sessionId,
      tenantId: context.tenantId,
      userId: context.userId,
      hostId: context.hostId,
      seq: this.nextSeq(context.sessionId),
      timestamp: new Date().toISOString(),
      type,
      source: 'gateway',
      payload,
    }

    logger.debug({
      sessionId: event.sessionId,
      hostId: event.hostId,
      userId: event.userId,
      seq: event.seq,
      type: event.type,
    }, 'Session audit event queued')

    if (type === 'session_started') {
      await this.repository.start({
        sessionId: context.sessionId,
        tenantId: context.tenantId,
        userId: context.userId,
        userNameSnapshot: String(payload.userName ?? `user #${context.userId}`),
        userEmailSnapshot: normalizeNullableString(payload.userEmail),
        hostId: context.hostId,
        hostNameSnapshot: String(payload.hostName ?? ''),
        hostIpSnapshot: String(payload.hostIp ?? ''),
        connectionMethod: String(payload.connectionMethod ?? 'direct'),
        ticketProvider: normalizeNullableString(payload.ticketProvider),
        ticketKey: normalizeNullableString(payload.ticketKey),
        ticketUrl: normalizeNullableString(payload.ticketUrl),
        startedAt: new Date(event.timestamp),
      })
      return
    }

    this.bufferEvent(event)

    if (type === 'session_ended' || type === 'session_error') {
      await this.flushChunk(context.sessionId)
      await this.repository.finish({
        sessionId: context.sessionId,
        status: type === 'session_error' ? 'FAILED' : 'COMPLETED',
        endedAt: new Date(event.timestamp),
      })
      if (type === 'session_ended') {
        await this.aiService?.schedulePostSessionSummary(context.sessionId, context.tenantId)
      }
      this.clearSession(context.sessionId)
      return
    }

    const chunk = this.chunksBySession.get(context.sessionId)
    if (chunk && chunk.rawBytes >= env.SESSION_AUDIT_CHUNK_MAX_BYTES) {
      await this.flushChunk(context.sessionId)
    }
  }

  clearSession(sessionId: number): void {
    this.seqBySession.delete(sessionId)
    this.chunksBySession.delete(sessionId)
    this.queueBySession.delete(sessionId)
  }

  private nextSeq(sessionId: number): number {
    const next = (this.seqBySession.get(sessionId) ?? 0) + 1
    this.seqBySession.set(sessionId, next)
    return next
  }

  private bufferEvent(event: SessionAuditEvent): void {
    const now = new Date(event.timestamp)
    const line = JSON.stringify({
      seq: event.seq,
      ts: event.timestamp,
      type: event.type,
      payload: event.payload,
    })

    const chunk = this.chunksBySession.get(event.sessionId) ?? {
      seq: 1,
      startedAt: now,
      endedAt: now,
      eventCount: 0,
      bytesInDelta: 0,
      bytesOutDelta: 0,
      rawBytes: 0,
      lines: [],
    }

    chunk.endedAt = now
    chunk.eventCount += 1
    chunk.lines.push(line)
    chunk.rawBytes += Buffer.byteLength(line + '\n', 'utf-8')

    if (event.type === 'stdin') {
      chunk.bytesInDelta += readBytesDelta(event.payload)
    } else if (event.type === 'stdout') {
      chunk.bytesOutDelta += readBytesDelta(event.payload)
    }

    this.chunksBySession.set(event.sessionId, chunk)
  }

  private async flushChunk(sessionId: number): Promise<void> {
    const chunk = this.chunksBySession.get(sessionId)
    if (!chunk || chunk.eventCount === 0) return

    const content = `${chunk.lines.join('\n')}\n`
    const stored = await this.storage.writeChunk(sessionId, chunk.seq, content)
    await this.repository.appendChunk({
      sessionId,
      seq: chunk.seq,
      startedAt: chunk.startedAt,
      endedAt: chunk.endedAt,
      eventCount: chunk.eventCount,
      storageKey: stored.storageKey,
      compression: 'none',
      compressedSize: stored.compressedSize,
      rawSize: stored.rawSize,
      bytesInDelta: chunk.bytesInDelta,
      bytesOutDelta: chunk.bytesOutDelta,
    })

    this.chunksBySession.set(sessionId, {
      seq: chunk.seq + 1,
      startedAt: chunk.endedAt,
      endedAt: chunk.endedAt,
      eventCount: 0,
      bytesInDelta: 0,
      bytesOutDelta: 0,
      rawBytes: 0,
      lines: [],
    })
  }
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readBytesDelta(payload: Record<string, unknown>): number {
  const bytes = payload.bytes
  return typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0
}
